---
title: "Processing Messages From IBM-MQ in Clojure"
date: 2019-10-08T12:07:27+05:30
draft: true
tags: ["clojure"]
---

The Order Management System(OMS) of our client exposes its operations in the form of messages via [IBM-MQ](https://www.ibm.com/products/mq). In this blog post, we are going to focus on the setup the infrastructure to receive and process these message in our application. I'll also be sharing how we implemented the error (exception) handling across the application. 

> This blog post is a part 6 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

### Setting up IBM-MQ for Local Development

We are going to leverage the IBM-MQ's developers edition [docker image](https://hub.docker.com/r/ibmcom/mq/) for the local development. 

The steps for running it are as follows. These steps assuming that you have docker installed in your machine.

```bash
# Pulling the latest Docker image
> docker pull ibmcom/mq:latest

# Start the Docker container with the specified configuration parameter
> docker run --env LICENSE=accept --env MQ_QMGR_NAME=QM1 \
             --volume qm1data:/mnt/mqm --publish 1414:1414 \
             --publish 9443:9443 --network mq-demo-network \
             --network-alias qmgr --detach \
             --env MQ_APP_PASSWORD=test123 \
             --name ibmmq \
             ibmcom/mq:latest
```

> We are explicitly setting the name `ibmmq` for this container, so that we don't need to repeat this configuration everytime when we start the container like `docker start ibmmq`. 

This `ibmmq` container expose two ports `9443`, a web console for the adminstartion and `1414`, to consume messages from IBM-MQ. 


### Intializing IBM-MQ Connection

IBM-MQ follows the [JMS](https://en.wikipedia.org/wiki/Java_Message_Service) standarad. So, working with this is staright-forward as depicted in this [tutorial](https://developer.ibm.com/messaging/learn-mq/mq-tutorials/develop-mq-jms/). 

Let's add the configuration paramters in the `config.edn` and read them using aero as we did for the other configurations.

```clojure
; resources/config.edn
{:app
 {:database {...}
  :log {...}
  :mq {:host     #or [#env "WHEEL_APP_MQ_HOST" "localhost"]
       :port     #or [#env "WHEEL_APP_MQ_PORT" 1414]
       :channel  #or [#env "WHEEL_APP_MQ_CHANNEL" "DEV.APP.SVRCONN"]
       :qmgr     #or [#env "WHEEL_APP_MQ_QMGR" "QM1"]
       :user-id  #or [#env "WHEEL_APP_MQ_USER_ID" "app"]
       :password #or [#env "WHEEL_APP_MQ_PASSWORD" "test123"]}}}
```

```clojure
; src/wheel/infra/config.clj
; ...
(defn mq []
  (get-in root [:app :mq]))
```

Then add the IBM-MQ client dependency in *project.clj*

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [com.ibm.mq/com.ibm.mq.allclient "9.1.0.0"]]
  ; ...
  )
```

Finally, define a new mount state `jms-conn` to hold the IBM-MQ's connection.

```bash
> touch src/wheel/infra/ibmmq.clj
```

```clojure
; src/wheel/infra/ibmmq.clj
(ns wheel.infra.ibmmq
  (:import [com.ibm.msg.client.jms JmsFactoryFactory]
           [com.ibm.msg.client.wmq WMQConstants])
  (:require [wheel.infra.config :as config]
            [mount.core :as mount]))

(defn- new-jms-conn [{:keys [host port channel qmgr user-id password]}]
  (let [ff (JmsFactoryFactory/getInstance WMQConstants/WMQ_PROVIDER)
        cf (.createConnectionFactory ff)]
    (doto cf
      (.setStringProperty WMQConstants/WMQ_HOST_NAME host)
      (.setIntProperty WMQConstants/WMQ_PORT port)
      (.setStringProperty WMQConstants/WMQ_CHANNEL channel)
      (.setIntProperty WMQConstants/WMQ_CONNECTION_MODE WMQConstants/WMQ_CM_CLIENT)
      (.setStringProperty WMQConstants/WMQ_QUEUE_MANAGER qmgr)
      (.setStringProperty WMQConstants/WMQ_APPLICATIONNAME "WHEEL")
      (.setBooleanProperty WMQConstants/USER_AUTHENTICATION_MQCSP true)
      (.setStringProperty WMQConstants/USERID user-id)
      (.setStringProperty WMQConstants/PASSWORD password))
    (.createConnection cf)))

(mount/defstate jms-conn
  :start (let [conn (new-jms-conn (config/mq))]
           (.start conn)
           conn)
  :stop (.close jms-conn))
```

To make this new state `jms-conn` to start during the application bootstrap, let's add the reference of this namespace in *infra/core.clj*

```clojure
; src/wheel/infra/core.clj
(ns wheel.infra.core
  (:require ; ...
            [wheel.infra.ibmmq :as ibmmq]))
; ...
```

Now when we `start` or the `stop` the application, we can see that this JMS connection is also getting started and stopped.

```clojure
wheel.infra.core=> (start-app)
{:started ["#'wheel.infra.config/root"
           "#'wheel.infra.database/datasource"
           "#'wheel.infra.database/toucan"
           "#'wheel.infra.ibmmq/jms-conn"]}
wheel.infra.core=> (stop-app)
{:stopped ["#'wheel.infra.ibmmq/jms-conn" 
           "#'wheel.infra.database/datasource"]}
```

### Client's Business Operation Model

For each items that our client sells in a marketplace, they will be adding it manually using the marketplace's seller portal. After that client performs the following four operations using the OMS. 

1. **Ranging** - Listing items to make them available for sales. 
2. **Deranging** - Unlisting items to prevent them from being shown in the marketplace. 
3. **Inventorying** - Upates the inventories of items.
4. **Pricing** - Upates the prices of items.

The OMS is configured to communciates these operations to the middleware via four different queues.

### Consuming Messages from IBM-MQ Queue

Let's a new configuration item `settings` in the *config.edn* file to specify the queue names the middleware has to listen. 

```clojure
; resources/config.edn
{:app {...}
 :settings {:oms {:ranging-queue-name "DEV.QUEUE.1"}}}
```

Then add a wrapper function in `config.clj` to read the settings.

```clojure
; src/wheel/infra/config.clj
; ...
(defn oms-settings []
  (get-in root [:settings :oms]))
```