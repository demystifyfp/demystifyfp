---
title: "Configuring Logging Using Timbre"
date: 2019-09-29T10:08:01+05:30
draft: true
tags: ["clojure"]
---

In the first two blog posts of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}), we learnt how to bootstrap a Clojure project using [Mount](https://github.com/tolitius/mount) & [Aero](https://github.com/juxt/aero) and how to configure database connection pooling & database migration along with reloaded workflow.

We are going to continue on setting up the infrastructure and in this blog post, we are going to take up logging using [Timbre](https://github.com/ptaoussanis/timbre). Timbre is a Clojure/Script logging library that enable to configure logging using a simple Clojure map. If you ever had a hard time dealing with complex (XML based) configuration setup for logging, you will defenitely feel a breath of fresh air while using Timbre. Let's dive in!

> This blog post is a part 3 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).


## Timbre 101

To get started, let's add the dependency in the `project.clj` and restart the REPL to download and include the dependency in our project. 

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [com.taoensso/timbre "4.10.0"]]
  ; ...
  )
```

Then create a new file `log.clj` and refer the `timbre` library.

```bash
> touch src/wheel/infra/log.clj
```

```clojure
(ns wheel.infra.log
  (:require [taoensso.timbre :as timbre]))
```

To play with the functionality provided by Timbre, send the above snippet to the REPL and then use any of the `info`, `warn`, `debug` or `error` function to perform the logging. By default, Timbre uses `println` to write the logs in the console (stdout to be precise).

```sh
wheel.infra.log=> (timbre/info "Hello Timbre!")
19-09-29 04:59:03 UnknownHost INFO [wheel.infra.log:1] - Hello Timbre!
nil
```

These functions also accepts Clojure maps.

```sh
wheel.infra.log=> (timbre/info {:Hello "Timbre!"})
19-09-29 05:02:44 UnknownHost INFO [wheel.infra.log:1] - {:Hello "Timbre!"}
nil
```

## Customizing the Output Log Format

The default output format is naive and not friendly for reading by an external tool like [logstash](https://www.elastic.co/products/logstash). We can modify the behaviour and use JSON as our output format by following the below steps. 

Let's add the [Chesire](https://github.com/dakrone/cheshire) library to take care of JSON serialization in the `project.clj` file. 

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [chesire "5.9.0"]]
  ; ...
  )
```

Then we are going the `output-fn` hook provided by Timbre. This hook is a function with the signature `(fn [data]) -> string`. The data is a map contains the actual message, log level, timestamp, hostname and much more. 

```clojure
; src/wheel/infra/log.clj
; ...
(defn- json-output [{:keys [level msg_ instant]}] ;<1>
  (let [event (read-string (force msg_))] ;<2>
    (json/generate-string {:timestamp instant ;<3>
                           :level level
                           :event event})))
```

<span class="callout">1</span> Destructures the interested keys from the `data` map. 

<span class="callout">2</span> Timbre use [delay](https://clojuredocs.org/clojure.core/delay) to holde the logging message. So, it retrieves the value using the [force](https://clojuredocs.org/clojure.core/force) function and then uses [read-string](https://clojuredocs.org/clojure.core/read-string) to convert the `string` to its corresponding Clojure data structure.

<span class="callout">3</span> Generates the stringified JSON representation of the log entry containing the log level, timestamp and the actual message. 

To wire this function with Timbre, we are going to make use of its `merge-config!` function.

```clojure
; src/wheel/infra/log.clj
; ...
(defn init []
  (timbre/merge-config! {:output-fn json-output}))
```

As the name indicates, the `init` function acts as the entry point for initialization the logging and here we are modifiying the Timbre's config to use our `json-output` function as its `output-fn` function.

Now if we log after calling this `init` function, we will get the output as below

```sh
wheel.infra.log=> (init)
{:level :debug, :ns-whitelist [], :ns-blacklist [] ...}
```

```sh
wheel.infra.log=> (timbre/info {:name :ranging/succeeded})
{"timestamp":"2019-09-29T05:30:42Z","level":"info","event":{"name":"ranging/succeeded"}}
nil
```
