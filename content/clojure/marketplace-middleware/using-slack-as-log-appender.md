---
title: "Using Slack as Log Appender"
date: 2019-10-05T11:05:41+05:30
draft: true
tags: ["clojure"]
---

The backoffice team of our client has an active slack based workflow for most of their systems. As this middleware is going to be yet an another system that they need to keep track of, they asked us to send messages on Slack if the middleware encounters an error during its operation. In this blog post, I am going to share how to do it in Clojure using Timbre.

> This blog post is a part 5 of the blog series [Building an E-Commerce Marketplace Middleware in Clojure]({{<relref "intro.md">}}).

### Slack Incoming Webhooks

Slack has the mechanism of [Incoming Webhooks](https://api.slack.com/incoming-webhooks) that provides a simple way to post messages from any application into Slack. By following [these steps](https://api.slack.com/incoming-webhooks#getting-started), we will get an unique *webhook* URL to which we can send a JSON payload with the message text and some other options.

### Sending Slack Message

To work with the HTTP post requests, let's add [clj-http](https://github.com/dakrone/clj-http) dependency in our *project.clj* and restart the REPL.

```clojure
(defproject wheel "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [; ...
                 [clj-http "3.10.0"]]
  ; ...
  )
```

Then create a new directory *slack* and a clojure file *webhook.clj* under it.

```bash
> mkdir src/wheel/slack
> touch src/wheel/slack/webhook.clj
```

Finally, create a function `post-message!` to post a message in a Slack channel using the webhook URL.

```clj
; src/wheel/slack/webhook.clj
(ns wheel.slack.webhook
  (:require [clj-http.client :as http]
            [cheshire.core :as json]))

(defn post-message! [webhook-url text attachments]
  (let [body (json/generate-string {:text text
                                    :attachments attachments})]
    (http/post webhook-url {:content-type :json
                            :body body})))
```

Let's try to execute this function in REPL

```clojure
wheel.slack.webhook=> (post-message! webhook-url "ranging failed"
                                     [{:color :danger
                                       :fields [{:title "Channel Name"
                                                 :value :tata-cliq
                                                 :short true}
                                                {:title "Channel Id"
                                                 :value "UA"
                                                 :short true}
                                                {:title "Event Id"
                                                 :value "2f763cf7-d5d7-492c-a72d-4546bb547696"}]}])
{:body "ok"
 ; ...
 }
```

We should something similar to this in the slack channel configured

![](/img/clojure/blog/ecom-middleware/sample-slack-event.png)