---
title: "Creating Cron Jobs in Clojure"
date: 2019-10-21T20:01:42+05:30
tags: ["clojure"]
draft: true
---

In the [last blog post]({{<relref "ranging-items-in-marketplaces.md">}}), we processed the messages from IBM-MQ and relayed the information to the marketplace. In this blog post, we are going to focus on adding cron job to our existing infrastructure. The cron jobs pull the data from the marketplace, perform some transformation and send it to the Order Management System(OMS) via IBM-MQ.

> This blog post is a part 8 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

## Leveraging Quartzite

We are going to leverage [Quartzite](http://clojurequartz.info/), scheduling library for Clojure to create and run cron jobs in our project. Quartzite is a Clojure wrapper of Java's [Quartz Job Scheduler](http://www.quartz-scheduler.org/), one of the most powerful and feature rich open source scheduling tools.

### Initializing the Scheduler

Let's get started by adding the dependency in the *project.clj*

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [clojurewerkz/quartzite "2.1.0"]]
  ; ...
  )
```

Then create a new clojure file *infra/cron/core.clj* to define a Mount state for the Quartz scheduler.

```bash
> mkdir src/wheel/infra/cron
> touch src/wheel/infra/cron/core.clj
```

```clojure
; src/wheel/infra/cron/core.clj
(ns wheel.infra.cron.core
  (:require [clojurewerkz.quartzite.scheduler :as qs]
            [mount.core :as mount]))

(mount/defstate scheduler
  :start (qs/start (qs/initialize))
  :stop (qs/shutdown scheduler))
```

This Mount state `scheduler` takes care of starting the Quartz scheduler during application bootstrap and shutting it down while closing the application.

### Creating Job

The next step is to implement an abstraction that creates different kids of Quartz [Jobs](https://www.quartz-scheduler.org/api/2.1.7/org/quartz/Job.html) required for our application.

```bash
> mkdir src/wheel/infra/cron/job
> touch src/wheel/infra/cron/job/core.clj
```

```clojure
; src/wheel/infra/cron/job/core.clj

(ns wheel.infra.cron.job.core
  (:require [clojurewerkz.quartzite.jobs :as qj]))

(defmulti job-type :type)

(defn- identifier [{:keys [channel-id type]}] 
  (str channel-id "/" (name type)))

(defn- create-job [channel-config cron-job-config] 
  (qj/build
   (qj/of-type (job-type cron-job-config)) ; <1>
   (qj/using-job-data {:channel-config  channel-config
                       :cron-job-config cron-job-config}) ; <2>
   (qj/with-identity (qj/key (identifier cron-job-config))))) ; <3>
```

The `create-job` is a generic function that takes configuration of a cron job and the configuration of the channel that the job is going to interact to. It builds the <span class="callout">1</span> Quartz's `Job` instance by getting the `JobType` using the multi-method `job-type`. While building it passes the configuration parameters to the Job using the [JobDataMap](https://www.quartz-scheduler.org/api/2.1.7/org/quartz/JobDataMap.html).

### Creating Trigger

The next functionality that we need is to have a function that creates a Quartz [Trigger](https://www.quartz-scheduler.org/api/2.1.7/org/quartz/Trigger.html). Trigger are the 'mechanism' by which Jobs are scheduled.

```clojure
; src/wheel/infra/cron/job/core.clj
(ns wheel.infra.cron.job.core
  (:require ;...
            [clojurewerkz.quartzite.schedule.cron :as qsc]
            [clojurewerkz.quartzite.triggers :as qt]))

; ...
(defn- create-trigger [{:keys [expression]
                        :as   cron-job-config}]
  (qt/build
   (qt/with-identity (qt/key (identifier cron-job-config)))
   (qt/with-schedule (qsc/schedule
                      (qsc/cron-schedule expression)))))
```

The `expression` attribute in the `cron-job-config` holds the [cron expression](http://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html#crontrigger-tutorial). The `create-trigger` function uses it to create and associate a schedule with the trigger.

### Scheduling Jobs For Execution

The final piece that we required is to have a function that takes a `cron-job-config` and schedule a Quartz Job for execution.

```clojure
; src/wheel/infra/cron/job/core.clj
(ns wheel.infra.cron.job.core
  (:require ;...
            [clojurewerkz.quartzite.scheduler :as qs]
            [wheel.infra.config :as config]))

; ...
(defn schedule [scheduler {:keys [channel-id]
                           :as   cron-job-config}]
  (when-let [channel-config (config/get-channel-config channel-id)] ; <1>
    (let [job     (create-job channel-config cron-job-config)
          trigger (create-trigger cron-job-config)]
      (qs/schedule scheduler job trigger)))) ; <2>
```

The final step is to get all the cron job configuration and scheduling it using this `schedule` function during the application bootstrap.

```clojure
; src/wheel/infra/cron/core.clj
(ns wheel.infra.cron.core
  (:require ; ...
            [wheel.infra.cron.job.core :as job]
            [wheel.infra.config :as config]))
; ...
(defn init []
  (for [cron-job-config (config/get-all-cron-jobs)]
    (job/schedule scheduler cron-job-config)))
```

```diff
# src/wheel/infra/core.clj

(ns wheel.infra.core
  (:require ...
+           [wheel.infra.cron.core :as cron]
            ...))

(defn start-app
   ...
-  (mount/start)))
+  (mount/start)
+  (cron/init)))    
```

## Adding Cron Job Configuration

The `config/get-all-cron-jobs` function in the above section is not a part of our application yet. So, let's fix it.

```clojure
; resources/config.edn
{:app      {...
 :settings {:oms       ...
            :channels  ...
            :cron-jobs [{:type       :allocate-order
                         :channel-id "UA"
                         :expression "0 0/1 * 1/1 * ? *"}]}}
```

```clojure
; src/wheel/infra/config.clj
; ...
(defn get-all-cron-jobs []
  (get-in root [:settings :cron-jobs]))
```

> NOTE: In the actual project, we stored the cron job configurations in the Postgres table with some additional attributes like `last-ran-at`, `next-run-at`. I am ignoring that here for brevity.

## Defining Allocate Order Job

One of the key cron job of the middleware is allocating an order. It periodically polls for new orders on a marketplace channel and allocate them in the OMS if any. In this blog post, we are going to look at how we processed the new orders from Tata-CliQ. As we did it in the last blog post, we are going to use a fake implemention of their new orders API.

As all the cron jobs are going to pull the channel and cron configuration information for the job context that we set during during the job creation in the `create-job` function and invoke a function in the channel, let's create a common handle function.

```clojure
; src/wheel/infra/cron/job/core.clj
; ...
(ns wheel.infra.cron.job.core
  (:require ; ...
            [clojurewerkz.quartzite.conversion :as qc]))

(defn handle [channel-fn ctx]
  (let [{:strs [channel-config cron-job-config]} (qc/from-job-data ctx)
        {:keys [channel-id]}                     cron-job-config
        {:keys [channel-name]}                   channel-config]
      (channel-fn channel-id channel-config)))
```

Then use this `handle` function to define the `AllocateOrder` job.

```batch
> touch src/wheel/infra/cron/job/allocate_order.clj
```

```clojure
; src/wheel/infra/cron/job/allocate_order.clj
(ns wheel.infra.cron.job.allocate-order
  (:require [wheel.infra.cron.job.core :as job]
            [clojurewerkz.quartzite.jobs :as qj]
            [wheel.marketplace.channel :as channel]))

(qj/defjob AllocateOrderJob [ctx]
  (job/handle channel/allocate-order ctx))

(defmethod job/job-type :allocate-order [_]
  AllocateOrderJob)
```

The higher-order function `channel/allocate-order` that we pass here to the `handle` function is a multi-method that takes care of the allocating order from different marketplace channels. This is also not defined yet. So, let's add them as well. 

```clojure
; src/wheel/marketplace/channel.clj
; ...

(defmulti allocate-order (fn [channel-id channel-config]
                           (:channel-name channel-config)))
```

## Implementing Order Allocation

