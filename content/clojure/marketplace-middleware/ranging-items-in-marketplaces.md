---
title: "Ranging Items In E-Commerce Marketplaces"
date: 2019-10-08T12:07:27+05:30
draft: true
tags: ["clojure"]
---

### Unified Message Handling & Exception Hadling 

The message listener that we defined is the entry point for all the four business operation. The handling logic of the message will be as follows.

![](/img/clojure/blog/ecom-middleware/message-handling-process.png)

* Upon receiving the message, the log the message as an OMS event to keep track of the messages that we recieved from the OMS.

* Then we parse the message (more on this in the later blog post), if it is a failure, we will be logging it as a error in the form of a System event.

* If parsing is successful, we will be performing the respective operation in the marketplace. If it succucceed, we log it a domain success event else we log it a domain failure event. These events treats the OMS event as the parent event. 

We don't have a spec for the OMS event yet. So, let's add it as a first step.

```diff
# src/wheel/middleware/event.clj

- (s/def ::type #{:domain :system })
+ (s/def ::type #{:domain :system :oms})
```

```clojure
; src/wheel/middleware/event.clj
; ...
(defmethod event-type :oms [_]
  (s/keys :req-un [::id ::name ::type ::level ::timestamp]))
```

All the three event types are going to have payloads that provide extra information about an event. To specify different payload specs, we first need to define the different event names.

Let's focus on ranging alone for now.

```clojure
(s/def ::oms-event-name #{:oms/items-ranged}) 
(s/def ::domain-event-name #{:ranging/succeeded})
(s/def ::error-event-name #{:ranging/failed})
```

* `:oms/items-ranged` - Ranging message receive from OMS
* `:ranging/succeeded` - Ranging operation successful in the maretplace
* `` - 