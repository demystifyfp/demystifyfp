---
title: "Creating a Twitter Clone in F# using Suave"
date: 2017-08-15T08:14:37+05:30
tags: ["fsharp", "suave", "FAKE"]
---

Hi!

I'm really excited to share with you the new blog post series, Creating a Twitter Clone in F# using Suave. 

The core objective of this series is answering the one question.

How can I create a **production-ready real-world business application end to end** in F# using functional programming principles?

I believe F# is one of the elegant programming language that can help developers to deliver robust softwares and add value to the businesses. 

It kindles a new thought process, a better perspective for developing software products. 

In this series we will be starting from the scratch (right from creating an empty directory for the project) and incrementantly add business features one at a time and wrap up with deploying to Azure. 

Overall, It's going to be lot of fun! Let's start our journey.

## Table of Contents

* [Setting Up FsTweet Project]({{<relref "project-setup.md">}})
* [Setting Up Server Side Rendering using DotLiquid]({{<relref "dotliquid-setup.md">}})
* [Serving Static Asset Files]({{<relref "static-assets.md">}})
* [Handling User signup Form]({{<relref "user-signup.md">}})
* [Validating New User Signup Form]({{<relref "user-signup-validation.md">}})
* [Setting Up Database Migration]({{<relref "db-migration-setup.md">}})
* [Orchestrating User Signup]({{<relref "orchestrating-user-signup.md">}})
* [Transforming Async Result to Webpart]({{<relref "transforming-async-result-to-webpart.md">}})
* [Persisting New User]({{<relref "persisting-new-user.md">}})
* [Sending Verification Email]({{<relref "sending-verification-email.md">}})
* [Verifying User Email]({{<relref "verifying-user-email.md">}})
* [Reorganising Code and Refactoring]({{<relref "reorganising-code-and-refactoring.md">}})
* [Adding Login Page]({{<relref "adding-login.md">}})
* [Handling Login Request]({{<relref "handling-login-request.md">}})
* [Creating User Session and Authenticating User]({{<relref "creating-user-session-and-authenticating-user.md">}})
* [Posting New Tweet]({{<relref "posting-new-tweet.md">}})
* [Adding User Feed]({{<relref "adding-user-feed.md">}})
* [Adding User Profile Page]({{<relref "adding-user-profile-page.md">}})
* [Following a User]({{<relref "following-a-user.md">}})
* [Fetching Followers and Following Users]({{<relref "fetching-followers-and-following-users.md">}})
* [Deploying to Azure App Service]({{<relref "deploying-to-azure-app-service.md">}})
* [Adding Logs using Logary]({{<relref "adding-logs.md">}})
* [Wrapping Up]({{<relref "wrapping-up.md">}})


## Acknowledgement

This entire series was initially planned to be released as a video course in [FSharp.TV](https://fsharp.tv/) after my [Build a Web Server based on Suave](https://www.udemy.com/learn-suave/?couponCode=DEMYSTIFY_FP) course. Due to some personal reasons, we couldn't complete it. Thank you [Mark](https://twitter.com/MarkRGray) for the courteous support to release the course as a blog series and book. 

I'd like to thank the entire [F# Community](http://fsharp.org/) for their open source contributions, support and thought provoking blog posts, articles and tutorials.  