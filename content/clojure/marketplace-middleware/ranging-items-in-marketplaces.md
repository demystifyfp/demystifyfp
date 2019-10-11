---
title: "Ranging and Deranging Items In E-Commerce Marketplaces"
date: 2019-10-11T12:07:27+05:30
draft: true
tags: ["clojure"]
---

### Ranging Message

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

### Validating the Ranging XML message

As a first step, we are going to validate whether the incoming message is a valid ranging message or not using the XSD file based [XML Validation](https://en.wikipedia.org/wiki/XML_validation).

The XSD file for the ranging message is available in [this gist](https://gist.github.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c#file-ranging-xsd)

To keep this XSD file (and the future XSD files), create a new directory *oms/message_schema* under *resources* directory and download the gist there.

```bash
> mkdir -p resources/oms/message_schema
> wget https://gist.githubusercontent.com/tamizhvendan/4544f0123bd30681be1c5198ed87522c/raw/2c2112bde069f6d002c184e8cfc5a6db77fbebcb/ranging.xsd -P resources/oms/message_schema 

# ...
- 'resources/oms/message_schema/ranging.xsd' saved 
```

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

Let's validate this in the REPL.

```clojure
wheel.xsd ==> (let [xsd-file (clojure.java.io/as-file 
                              (clojure.java.io/resource 
                                "oms/message_schema/ranging.xsd"))
                    sample "
                <EXTNChannelList>
                  <EXTNChannelItemList>
                    <EXTNChannelItem ChannelID=\"UA\" EAN=\"EAN_1\" 
                                    ItemID=\"SKU1\" RangeFlag=\"Y\"/>
                    <EXTNChannelItem ChannelID=\"UA\" EAN=\"EAN_2\" 
                                    ItemID=\"SKU2\" RangeFlag=\"Y\"/>
                  </EXTNChannelItemList>
                  <EXTNChannelItemList>
                    <EXTNChannelItem ChannelID=\"UB\" EAN=\"EAN_3\" 
                                    ItemID=\"SKU3\" RangeFlag=\"Y\"/>
                  </EXTNChannelItemList>
                </EXTNChannelList>
                  "]
                (validate xsd-file sample))
nil
```

### Defining Spec For Ranging Message

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

### Parsing Ranging Message

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