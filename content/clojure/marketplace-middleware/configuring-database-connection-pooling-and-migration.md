---
title: "Configuring Database Connection Pooling and Migration"
date: 2019-08-02T05:39:03+05:30
tags: ["clojure"]
draft: true
---

Let's get started by adding the [hikari-cp](https://github.com/tomekw/hikari-cp), a Clojure wrapper to [HikariCP](https://github.com/brettwooldridge/HikariCP), and the postgres driver dependencies in the `project.clj`. 

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [org.postgresql/postgresql "42.2.6"]
                 [hikari-cp "2.8.0"]]
  ; ...
  )
```

> NOTE: If you already have a running (and jacked in) REPL, you need to stop and start it again after adding any dependencies in the `project.clj` file.

To configure the hikari connection pool, Let's create a new file `database.clj` in the `infra` directory. 

```bash
> touch src/wheel/infra/database.clj
```

Then define a mount state `datasource` to manage the life-cycle of the connection pool.

```clojure
(ns wheel.infra.database
  (:require [wheel.infra.config :as config]
            [mount.core :as mount]
            [hikari-cp.core :as hikari]))

(defn- make-datasource []
  (hikari/make-datasource (config/database))) ;<1>

(mount/defstate datasource
  :start (make-datasource)
  :stop (hikari/close-datasource data-source))
```


<span class="callout">1</span> Retrieves the database configuration and creates the datasource object.

Now if we start the application through mount, we will get the following output.

```sh
wheel.infra.database=> (mount/start)
{:started ["#'wheel.infra.config/root" 
           "#'wheel.infra.database/data-source"]}
```