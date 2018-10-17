---
title: "RESTful CRUD APIs Using Compojure-API and Toucan (Part-2)"
date: 2018-10-17T16:39:17+05:30
tags: ["clojure"]
draft: true
---

Hi,

In the [last blog post]({{<relref "restful-crud-apis-using-compojure-api-and-toucan-part-1.md">}}), we learned how to implement RESTful APIs using Compojure-API & Toucan. We are going to generalize the example that we saw there by creating a small abstraction around it. 

The abstraction that we are going to create is going to help us in creating similar RESTful endpoints for any domain entities with less code. 

Let's dive in!

## The Book Entity
To abstract what we did there, we need few more specific implementation. So, let's repeat what we did there with an another entity called "Book".

```bash
> psql -d restful-crud

restful-crud:> CREATE TABLE book (
                id SERIAL PRIMARY KEY,
                title VARCHAR(100) NOT NULL,
                year_published INTEGER NOT NULL
              );
CREATE TABLE

restful-crud:>
```

The next step after creating a `book` table is to create a [Toucan model](https://github.com/metabase/toucan/blob/master/docs/defining-models.md).

```clojure
; src/resultful_crud/models/book.clj
(ns resultful-crud.models.book
  (:require [toucan.models :refer [defmodel]]))

(defmodel Book :book)
```

Then create a schema for `Book`

```clojure
; src/resultful_crud/book.clj
(ns resultful-crud.book
  (:require [schema.core :as s]
            [resultful-crud.string-util :as str]))

(defn valid-book-title? [title]
  (str/non-blank-with-max-length? 100 title))

(defn valid-year-published? [year]
  (<= 2000 year 2018))

(s/defschema BookRequestSchema
  {:title (s/constrained s/Str valid-book-title?)
   :year_published (s/constrained s/Int valid-year-published?)})
```

To expose the CRUD APIs let's repeat what we did for `User`.

```clojure
; src/resultful_crud/book.clj
(ns resultful-crud.book
  (:require ; ...
            [resultful-crud.models.book :refer [Book]]
            [toucan.db :as db]
            [ring.util.http-response :refer [ok not-found created]]
            [compojure.api.sweet :refer [GET POST PUT DELETE]]))

;; Create
(defn id->created [id]
  (created (str "/books/" id) {:id id}))

(defn create-book-handler [create-book-req]
  (-> (db/insert! Book create-book-req)
      :id
      id->created))

;; Get All
(defn get-books-handler []
  (ok (db/select Book)))

;; Get By Id
(defn book->response [book]
  (if book
    (ok book)
    (not-found)))

(defn get-book-handler [book-id]
  (-> (Book book-id)
      book->response))

;; Update
(defn update-book-handler [id update-book-req]
  (db/update! Book id update-book-req)
  (ok))

;; Delete
(defn delete-book-handler [book-id]
  (db/delete! Book :id book-id)
  (ok))

;; Routes
(def book-routes
  [(POST "/books" []
     :body [create-book-req BookRequestSchema]
     (create-book-handler create-book-req))
   (GET "/books" []
     (get-books-handler))
   (GET "/books/:id" []
     :path-params [id :- s/Int]
     (get-book-handler id))
   (PUT "/books/:id" []
     :path-params [id :- s/Int]
     :body [update-book-req BookRequestSchema]
     (update-book-handler id update-book-req))
   (DELETE "/books/:id" []
     :path-params [id :- s/Int]
     (delete-book-handler id))])
```

The last step is exposing these routes as HTTP endpoints.

```diff
; src/resultful_crud/core.clj
(ns resultful-crud.core
  (:require 
+           [resultful-crud.book :refer [book-routes]]))
...
(def app (api {:swagger swagger-config} 
-  (apply routes user-routes)))
+  (apply routes (concat user-routes book-routes))))
```

## The RESTful Abstraction

If we have a closer look at 
