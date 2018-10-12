---
title: "RESTful CRUD APIs Using Compojure Api and Toucan - Part 1"
date: 2018-10-12T11:39:17+05:30
draft: true
tags: ["clojure"]
---

Hi,

In my [last blog post]({{<relref "clojure-in-production.md">}}) on our experiences in using Clojure in production, I mentioned that we used [Compojure API](https://github.com/metosin/compojure-api) and [Toucan](https://github.com/metabase/toucan) to implement CRUD APIs. The abstraction that we created using these libraries helped us to create HTTP CRUD APIs for any domain entity in a matter of minutes. In this small blog-post series, I am going to share how we did it.

This first part is going to focus on developing a RESTful CRUD APIs for a specific domain entity. In the next part, we are going to generalize the implemention to make it extendable for other domain entities. 

## Project Setup

In this blog post, we are going to develop the CRUD APIs for domain entity `user` with PostgreSQL as the database. 

Let's create a new Clojure project using [Leiningen](https://leiningen.org/)

```bash
> lein new app resultful-crud
```

And then add the following dependencies in *project.clj*.

```clj
(defproject resultful-crud "0.1.0-SNAPSHOT"
  ; ...
  :dependencies [[org.clojure/clojure "1.9.0"]

                 ; Web
                 [prismatic/schema "1.1.9"]
                 [metosin/compojure-api "2.0.0-alpha26"]
                 [ring/ring-jetty-adapter "1.6.3"]

                 ; Database
                 [toucan "1.1.9"]
                 [org.postgresql/postgresql "42.2.4"]

                 ; Password Hashing
                 [buddy/buddy-hashers "1.3.0"]]
  ; ...
  )
```

To keep things simple, we are going to create the database and create the table directly using `psql` instead of using database migration utilities like [Flyway](https://flywaydb.org/).

```bash
> createdb restful-crud

> psql -d restful-crud

restful-crud:> CREATE TABLE "user2" (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
              );
CREATE TABLE

restful-crud:>
```