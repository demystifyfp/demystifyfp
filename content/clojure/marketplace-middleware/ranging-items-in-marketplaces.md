---
title: "Ranging and Deranging Items In E-Commerce Marketplaces"
date: 2019-10-11T12:07:27+05:30
draft: true
tags: ["clojure"]
---

### Unified Message Handling

The handling logic of all the messages will be as follows.

![](/img/clojure/blog/ecom-middleware/message-handling-process.png)

1. Upon receiving the message, the log the message as an OMS event to keep track of the messages that we recieved from the OMS.

2. Then we parse the message (more on this in the later blog post), if it is a failure, we will be logging it as a error in the form of a System event.

3. If parsing is successful, for each channel in the message, we check whether the given channel exists. 

4. If the channel exists, we will be performing the respective operation in the marketplace. If the operation succucceeds, we log it as a domain success event else we log it as a domain failure event. 

5. If the channel not found, we'll be logging as a system event.

Events from steps two to five, treats the OMS event (step one) as the parent event. 

### Revisiting Event Spec

As a first step towards implementing this unified message handling, let's start from adding the event type `:oms`.

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

#### Adding Payload Spec

All the three event types are going to have payloads that provide extra information about an event. To specify different payload specs, we first need to define the different event names.

```clojure
; src/wheel/middleware/event.clj
; ...
(s/def ::oms-event-name #{:oms/items-ranged})
(s/def ::domain-event-name #{})
(s/def ::system-event-name #{:system/parsing-failed
                             :system/channel-not-found})

(s/def ::name ...
; ...
```

* `:oms/items-ranged` - Ranging message received from OMS
* `:system/parsing-failed` - Parsing ranging message failed.
* `:system/channel-not-found` - Channel specified in the ranging message not found.

> We are leaving the `domain-event-name` spec as an empty set for now.

Earlier we had the had the spec for the `name` as `qualified-keyword?`. We have to change it to either one of the above event-name spec.

```diff
# src/wheel/middleware/event.clj

- (s/def ::name qualified-keyword?)
+ (s/def ::name (s/or :oms ::oms-event-name 
+                     :domain ::domain-event-name
+                     :system ::system-event-name))
```

Before defining the payload type for these event-names, let's add the spec for the messages from OMS.

```bash
> touch src/wheel/oms/message.clj
```

```clojure
; src/wheel/oms/message.clj
(ns wheel.oms.message
  (:require [clojure.spec.alpha :as s]))

(s/def ::type #{:ranging})
(s/def ::id uuid?)
(s/def ::message (s/and string? (complement clojure.string/blank?)))

(s/def ::oms-message
       (s/keys :req-un [::type ::id ::message]))
```

Then add the event payload spec as below

```clojure
; src/wheel/middleware/event.clj
(ns wheel.middleware.event
  (:require ; ...
            [wheel.oms.message :as oms-message]))
; ...
(defmulti payload-type :type)

(defmethod payload-type :oms/items-ranged [_]
  (s/keys :req-un [::oms-message/message]))

(s/def ::error-message (s/and string? (complement clojure.string/blank?)))

(s/def ::message-type ::oms-message/type)
(defmethod payload-type :system/parsing-failed [_]
  (s/keys :req-un [::error-message ::message-type]))

(defmethod payload-type :system/channel-not-found [_]
  (s/keys :req-un [::channel-id]))

(defmethod payload-type :default [_]
  (s/keys :req-un [::type]))
(s/def ::payload (s/multi-spec payload-type :type))

(defmulti event-type ...
; ...
```

Finally, add this `payload` spec in all the `event` spec.

```diff
# src/wheel/middleware/event.clj

(defmethod event-type :system [_]
-  (s/keys :req-un [::id ::name ::type ::level ::timestamp]
+  (s/keys :req-un [::id ::name ::type ::level ::timestamp ::payload]
           :opt-un [::parent-id]))
(defmethod event-type :domain [_]
-  (s/keys :req-un [::id ::name ::type ::level ::timestamp 
+  (s/keys :req-un [::id ::name ::type ::level ::timestamp ::payload
                    ::channel-id ::channel-name]
           :opt-un [::parent-id]))
(defmethod event-type :oms [_]
-  (s/keys :req-un [::id ::name ::type ::level ::timestamp]))
+  (s/keys :req-un [::id ::name ::type ::level ::timestamp ::payload]))
```

#### System Processing Failed Event

To model the unhadled exception while processing a message from OMS, let's add new event name `:system/processing-failed`.

```clojure
; src/wheel/middleware/event.clj
; ...
(s/def ::system-event-name #{ ;...
                             :system/processing-failed})
; ...
(s/def ::stacktrace (s/and string? (complement clojure.string/blank?)))

(defmethod payload-type :system/processing-failed [_]
  (s/keys :req-un [::error-message ::stacktrace]))

; ...
```


### Implementing Unified Message Handler

With the spec for all the possible events in place, now it's time to implement the message handler for all the messages from OMS.


Let's start it from the rewriting message listener that we implemented in the [last blog post]({{<relref "processing-messages-from-ibmmq-in-clojure.md#consuming-messages-from-ibm-mq-queue">}})

```clojure
; src/wheel/infra/oms.clj
(ns wheel.infra.oms
  (:require ; ...
            [wheel.middleware.event :as event]
            [wheel.middleware.core :as middleware] ; <1>
            [wheel.infra.log :as log])
  ; ...
  )
; ...
(defn- message-listener [message-type oms-event-name] ; <2>
  (proxy [MessageListener] []
    (onMessage [^Message msg]
      (try
        (let [message   (.getBody msg String)
              oms-event (event/oms oms-event-name message)] ; <3>
          (->> (middleware/handle {:id      (:id oms-event) ; <4>
                                   :message message
                                   :type    message-type}) 
               (cons oms-event) ; <5>
               log/write-all!)) ; <6>
        (catch Throwable ex 
          (log/write! (event/processing-failed ex))))))) ; <7>
; ...
```

<span class="callout">1</span> & <span class="callout">4</span> The namespace `wheel.middleware.core` doesn't exist yet. We'll be adding it few minutes. This namespace is going to have a function `handle` that takes `oms-message` and performs the required actions in the marketplace. Then it returns a collection of events that represent the results of these actions. Think of this like a router in a web application.

<span class="callout">2</span> The rewritten version of the `message-listener` function now takes two parameters, `message-type` and  `oms-event-name`. This parameters make it generic for processing the different types of messages from OMS.

<span class="callout">3</span> & <span class="callout">7</span> The `oms` and `processing-failed` functions in the `wheel.middleware.event` namespace are also not added yet and we'll be adding them in the next step. This functions constructs a event of type `oms` and `system` with the paramters passed.

<span class="callout">5</span> We are prepending the `oms-event` with the results from the `handle` functions. This `oms-event` is the parent event that triggered all other events 

<span class="callout">6</span> Once, we got all the events, we are writing in the log using the `write-all!` function that we defined earlier. 

As we have changed the signature of the `message-listener` function, let's update the `ranging-consumer` state that we defined using it.

```diff
  (mount/defstate ranging-consumer
    :start (let [queue-name (:ranging-queue-name (config/oms-settings))
-                listener   (message-listener)]
+                listener   (message-listener :ranging :oms/items-ranged)]
            (start-consumer queue-name jms-ranging-session listener))
    :stop (stop ranging-consumer))
```

Here we are creating of message-listener for handling the `:ranging` message from the OMS and we name the message received from OMS as `:oms/items-ranged`

This design follows a varient of the [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/talks/boundaries) technique.

#### Adding Event Create Functions

In the `message-listener` function, we are calling two functions `event/oms` to `event/processing-failed` to create events. These functions doesn't exist yet. So, let's add it.

```diff
# src/wheel/offset-date-time.clj

  (ns wheel.offset-date-time
    (:require [clojure.spec.alpha :as s])
    (:import [java.time.format DateTimeFormatter DateTimeParseException]
-            [java.time OffsetDateTime]))	           
+            [java.time OffsetDateTime ZoneId]))
# ...
+ (defn ist-now []
+   (OffsetDateTime/now (ZoneId/of "+05:30")))
```

```clojure
; src/wheel/middleware/event.clj
(ns wheel.middleware.event
  (:require ; ...
            [clojure.stacktrace :as stacktrace]
            [wheel.offset-date-time :as offset-date-time]
            [wheel.oms.message :as oms-message])
  (:import [java.util UUID]))
; ...

(defn- event [event-name payload &{:keys [level type parent-id]
                                   :or   {level :info
                                          type  :domain}}] ; <1>
  {:post [(s/assert ::event %)]}
  (let [event {:id        (UUID/randomUUID)
               :timestamp (str (offset-date-time/ist-now))
               :name      event-name
               :level     level
               :type      type
               :payload   (assoc payload :type event-name)}]
    (if parent-id
      (assoc event :parent-id parent-id)
      event)))

(defn oms [oms-event-name message]
  {:pre [(s/assert ::oms-event-name oms-event-name)
         (s/assert ::oms-message/message message)]
   :post [(s/assert ::event %)]}
  (event oms-event-name 
         {:message message}
         :type :oms))

(defn- ex->map [ex]
  {:error-message (with-out-str (stacktrace/print-throwable ex))
   :stacktrace (with-out-str (stacktrace/print-stack-trace ex 3))})

(defn processing-failed [ex]
  {:post [(s/assert ::event %)]}
  (event :system/processing-failed
         (ex->map ex)
         :type :system
         :level :error))
```

<span class="callout">1</span> The `event` function takes the name and payload (without type) of the event along with set a [keyword arguments](https://clojure.org/guides/destructuring#_keyword_arguments) and constructs a Clojure map that conforms to the `event` spec.

Let's also add the `parsing-failed` function to construct the `parsing-failed` event which we will be using shortly.

```clojure
; src/wheel/middleware/event.clj
; ...
(defn parsing-failed [parent-id message-type error-message]
  {:pre [(s/assert uuid? parent-id)
         (s/assert ::oms-message/type message-type)
         (s/assert ::error-message error-message)]
   :post [(s/assert ::event %)]}
  (event :system/parsing-failed 
         {:error-message error-message
          :message-type message-type}
         :parent-id parent-id
         :type :system
         :level :error))
```

#### Adding Message Handler

The `message-listener` function at the application boundary, creates the `oms-message` with the message received from IBM-MQ and pass it to the middleware to handle. This middleware's `handle` function also not implemented yet. So, let's add it as well.

```bash
> touch src/wheel/middleware/core.clj
```

The messages from OMS are XML encoded. So, the handler has to validate it against a [XML schema](https://en.wikipedia.org/wiki/XML_Schema_(W3C)). If it valid, then it has to be parsed to a clojure data structure (sequence of maps). This parsed data structure is also validated but this time using clojure.spec to make sure that the message is a processable one. If the validation fails, we'll be returning the `parsing-failed` events.

```clojure
(ns wheel.middleware.core
  (:require [clojure.spec.alpha :as s]
            [clojure.java.io :as io]
            [wheel.middleware.event :as event]
            [wheel.oms.message :as oms-message]
            [wheel.xsd :as xsd]))

; <1>
(defmulti xsd-resource-file-path :type) 
(defmulti parse :type)
(defmulti spec :type)

(defn- validate-message [oms-msg]
  (-> (xsd-resource-file-path oms-msg)
      io/resource
      io/as-file
      (xsd/validate (:message oms-msg)))) ; <2>

(defn handle [{:keys [id type]
               :as   oms-msg}]
  {:pre  [(s/assert ::oms-message/oms-message oms-msg)]
   :post [(s/assert (s/coll-of ::event/event :min-count 1) %)]}
  (if-let [err (validate-message oms-msg)]
    [(event/parsing-failed id type err)]
    (let [parsed-oms-message (parse oms-msg)]
      (if (s/valid? (spec oms-msg) parsed-oms-message)
        (throw (Exception. "todo")) ; <3>
        [(event/parsing-failed
          id type
          (s/explain-str (spec oms-msg) parsed-oms-message))]))))
```

<span class="callout">1</span> We are defining three multimethods `xsd-resource-file-path`, `parse` & `spec` to get the XML schema file path in the *resources* directory, parse the XML message to Clojure data structure and to get the expected clojure.spec of the parsed message respectively. Each OMS message type (ranging, deranging, etc.,) has to have an implmentation for these multimethods. 

<span class="callout">2</span> The `validate-message` performs the XML schema based validation of the incoming message. We'll be adding the `wheel.xsd/validate` function shortly.

<span class="callout">3</span> We are leaving the implementation of handling a valid message as "todo" for a short while.

Then add a new file *xsd.clj* and implement the XML validation based on XSD as mentioned in this [stackoverflow answer](https://stackoverflow.com/questions/15732/whats-the-best-way-to-validate-an-xml-file-against-an-xsd-file)

```bash
> touch src/wheel/xsd.clj
```

```clojure
; src/wheel/xsd.clj
(ns wheel.xsd
  (:import [javax.xml.validation SchemaFactory]
           [javax.xml XMLConstants]
           [org.xml.sax SAXException]
           [java.io StringReader File]
           [javax.xml.transform.stream StreamSource]))

(defn validate [^File xsd-file ^String xml-content]
  (let [validator (-> (SchemaFactory/newInstance 
                       XMLConstants/W3C_XML_SCHEMA_NS_URI)
                      (.newSchema xsd-file)
                      (.newValidator))]
    (try
      (->> (StringReader. xml-content)
           StreamSource.
           (.validate validator))
      nil
      (catch SAXException e (.getMessage e)))))
```

This `validate` function takes a `xsd-file` of type `java.io.File` and the `xml-content` of type `String`. It returns either `nil` if the `xml-content` conforms to the XSD file provided or the validation error message otherwise. 


#### Adding Ranging Message Handler

A sample ranging message from the OMS would look like this

```xml
<EXTNChannelList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UA" EAN="EAN_1" ItemID="SKU1" RangeFlag="Y"/>
    <EXTNChannelItem ChannelID="UA" EAN="EAN_2" ItemID="SKU2" RangeFlag="Y"/>
  </EXTNChannelItemList>
  <EXTNChannelItemList>
    <EXTNChannelItem ChannelID="UB" EAN="EAN_3" ItemID="SKU3" RangeFlag="Y"/>
  </EXTNChannelItemList>
</EXTNChannelList>
```

The `EXTNChannelItemList` element(s) specifies which channel that we have to communicate and the `EXTNChannelItem` element(s) specifies the items that has to be ranged within that channel.

##### Validating the Ranging XML message

As a first step, we are going to validate whether the incoming message is a valid ranging message or not using the XSD file based [XML Validation](https://en.wikipedia.org/wiki/XML_validation).

The XSD file for the ranging message is available in [this gist](https://gist.github.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c#file-ranging-xsd)

To keep this XSD file (and the future XSD files), create a new directory *oms/message_schema* under *resources* directory and download the gist there.

```bash
> mkdir -p resources/oms/message_schema
> wget https://gist.githubusercontent.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c/raw/2c2112bde069f6d002c184e8cfc5a6db77fbebcb/ranging.xsd -P resources/oms/message_schema 

# ...
- 'resources/oms/message_schema/ranging.xsd' saved 
```


##### Defining Spec For Ranging Message

The XML validation ensure that we are getting a valid XML message. However The XML message content has to be converted to a Clojure data strcture for further processing. Before doing that let's define the spec for the ranging message.

Given we are receiving the above XML as a message, we will be transforming it to a Clojure sequence as below

```clojure
({:channel-id "UA", :items ({:ean "EAN_1", :id "SKU1"} 
                            {:ean "EAN_2 ", :id "SKU2"})}
 {:channel-id "UB", :items ({:ean "EAN_3", :id "SKU3"})})
```

To add a spec for this, Let's add the spec for the `id` and the `ean` of the item.

```bash
> mkdir src/wheel/oms
> touch src/wheel/oms/item.clj
```

```clojure
; src/wheel/oms/item.clj
(ns wheel.oms.item
  (:require [clojure.spec.alpha :as s]))

(s/def ::id (s/and string? (complement clojure.string/blank?)))
(s/def ::ean (s/and string? (complement clojure.string/blank?)))
```

Then use these specs to define the spec for the ranging message.

```bash
> touch src/wheel/middleware/ranging.clj
```

```clojure
; src/wheel/middleware/ranging.clj
(ns wheel.middleware.ranging
  (:require [clojure.spec.alpha :as s]
            [wheel.oms.item :as oms-item]
            [wheel.marketplace.channel :as channel]))

(s/def ::item
  (s/keys :req-un [::oms-item/ean ::oms-item/id]))

(s/def ::items (s/coll-of ::item :min-count 1))

(s/def ::channel-id ::channel/id)
(s/def ::channel-items
  (s/keys :req-un [::channel-id ::items]))

(s/def ::message
  (s/coll-of ::channel-items :min-count 1))
```

##### Parsing Ranging Message

The next step is parsing the xml content to a ranging message that statsifies the above spec.

The [parse](https://clojuredocs.org/clojure.xml/parse) function from `clojure.xml` namespace parses the XML and returns a tree of xml elements. 

```clojure
wheel.middleware.ranging==> (clojure.xml/parse (java.io.StringBufferInputStream. "{above xml content}"))
{:attrs nil,
 :content [{:attrs nil,
            :content [{:attrs {:ChannelID "UA", :EAN "UA_EAN_1", 
                               :ItemID "SKU1", :RangeFlag "Y"},
                       :content nil,
                       :tag :EXTNChannelItem}
                      {:attrs {:ChannelID "UA", :EAN "UA_EAN_2 ", 
                               :ItemID "SKU2", :RangeFlag "Y "},
                       :content nil,
                       :tag :EXTNChannelItem}],
            :tag :EXTNChannelItemList}
           {:attrs nil,
            :content [{:attrs {:ChannelID "UB", :EAN "UB_EAN_3", 
                               :ItemID "SKU3", :RangeFlag "Y"},
                       :content nil,
                       :tag :EXTNChannelItem}],
            :tag :EXTNChannelItemList}],
 :tag :EXTNChannelList}
```

And we have to transform it to

```clojure
({:channel-id "UA", :items ({:ean "EAN_1", :id "SKU1"} 
                            {:ean "EAN_2 ", :id "SKU2"})}
 {:channel-id "UB", :items ({:ean "EAN_3", :id "SKU3"})})
```

Let's do it

```clojure
; src/wheel/middleware/ranging.clj
(ns wheel.middleware.ranging
  (:require ; ...
            [clojure.xml :as xml])
  (:import [java.io StringBufferInputStream]))

; ...

(defn- to-channel-item [{:keys [EAN ItemID]}]
  {:ean EAN
   :id ItemID})

(defn- parse-message [message]
  {:post [(s/assert ::message %)]}
  (->> (StringBufferInputStream. message)
       xml/parse
       :content
       (mapcat :content)
       (map :attrs)
       (group-by :ChannelID)
       (map (fn [[id xs]]
              {:channel-id  id
               :items (map to-channel-item xs)}))))
```

> Note: This kind of nested data transformation can also be acheieved using [XML Zippers](https://ravi.pckl.me/short/functional-xml-editing-using-zippers-in-clojure) or [Meander](https://github.com/noprompt/meander).