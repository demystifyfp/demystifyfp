---
title: "Building an E-Commerce Marketplace Middleware in Clojure"
date: 2019-07-16T09:20:14+05:30
draft: true
tags: ["clojure"]
---

At [Ajira](www.ajira.tech), we partnered with a leading retail chain for consumer electronics & durables and built an e-commerce marketplace middleware, which enables them to sell their products on multiple e-commerce sites seamlessly.

Based on our [experience]({{<relref "clojure-in-production.md">}}), we felt Clojure would be the right choice for developing the middleware. It turned out well and helped us to roll out the product with ease.

Through this short blog post series, I am planning to share how we built it in Clojure and some of our learnings. 

## Problem Statement

The retailer (our client) runs 134 stores across 32 cities in India. In addition to this, they sell their products in e-commerce marketplaces [Tata-Cliq](https://tatacliq.com), [Amazon](https://wwww.amazon.in) and [Flipkart](https://www.flipkart.com). 

For managing the products inventory, updating the products pricing and honoring the customer orders in their 134 stores, they are using a proprietary Order Management System (OMS). To perform the similar activities in the e-commerce markeplace sites, they were manually doing it from the markeplace site's seller portal. This back office work is repetative and laboursome. 

They wanted to unify everything using their OMS and wanted a middleware which will listen to the changes in the OMS and perform the order management activities across different marketplaces without any manual intervention. 

## 10,000 Foot View

The system that we built would look like this.

![](/img/clojure/blog/ecom-middleware/middleware-10K-View.png)

The retailer's back office team perform their operations with their OMS. The OMS exposes these activities to the outside system using [IBM MQ](https://www.ibm.com/support/knowledgecenter/en/SSFKSJ_8.0.0/com.ibm.mq.pro.doc/q001020_.htm). 

In response to messages from the OMS, the middleware perform the respective operations (listing a product, unlisting a product, updating price of a product, etc.,) in the marketplace site. 

The middleware also runs some cron jobs which periodically pulls the new orders and order cancellations from the marketplaces and communicate it back to the middlware via IBM MQ. 

The middleware has its own database to persists its operational data and exposes this data to the back office team via a dashboard powered by [Metabase](https://metabase.com). 

## How we developed it

In the upcoming blog posts, I will be sharing how we built it and I will also be updating the below list with the new blog post links. 

* [Bootstraping the Clojure Project with Mount]()