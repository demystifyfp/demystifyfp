---
title: "Adding Logs using Logary"
date: 2017-11-11T16:37:49+05:30
draft: true
---

Hi!

Welcome Back!!

In this twenty second part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series, we are going to improve how we are logging the exceptions in FsTweet. 


## What's Wrong With Current Logic

Can you guess what went wrong by looking at the below log of FsTweet?

```bash
System.AggregateException: One or more errors occurred. ---> Stream.StreamException: Error: NameResolutionFailure
  at Stream.StreamException.FromResponse (RestSharp.IRestResponse response) [0x00075] in <5158106fb22e4063ad9c9f74906b6f9e>:0
  at Stream.StreamFeed+<AddActivity>d__22.MoveNext () [0x00139] in <5158106fb22e4063ad9c9f74906b6f9e>:0
   --- End of inner exception stack trace ---
---> (Inner Exception #0) Stream.StreamException: Error: NameResolutionFailure
  at Stream.StreamException.FromResponse (RestSharp.IRestResponse response) [0x00075] in <5158106fb22e4063ad9c9f74906b6f9e>:0
  at Stream.StreamFeed+<AddActivity>d__22.MoveNext () [0x00139] in <5158106fb22e4063ad9c9f74906b6f9e>:0 <---
```

We'll get the above error, if the internet connection is down when we post a tweet.

And the code that is logging this exception look like this

```fsharp
let onPublishTweetFailure (err : PublishTweetError) =
  match err with
  | NotifyTweetError (tweetId, ex) ->
      printfn "%A" ex
      onPublishTweetSuccess tweetId
  // ...
```

The way we are dealing with logging exceptions in FsTweet is so naive and clearly it is not helping us to troubleshoot. Let's fix this before we wrap it up!

## Introducing Logary

[Logary](https://github.com/logary/logary) is a high-performance, semantic logging, health and metrics library for .Net. It enable us to log what happened in the application in a meaningful way which in turn help us a lot in analysing them. 

The [Logary](https://www.nuget.org/packages/Logary/) NuGet package, has a dependency on [NodaTime](https://www.nuget.org/packages/NodaTime/) NuGet package.

At the time of this writing, there is [an incompatability issue](https://github.com/logary/logary/issues/239) with NodaTime version 2.0 in Logary and the NodaTime version which works well with Logary is `1.3.2`.

So, before adding the Logary package, we first need to add the NodaTime v1.3.2 package and then the Logary package. 

```bash
> forge paket add NodaTime -V 1.3.2 \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
> forge paket add Logary \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

> If we just added Logary, while adding, it will pull the NodaTime 2.0 version 

Now we have the Logary package added to our Application

## The Logging Approach

There are multiple ways that we can leverage Logary in our application. One of the approach that fits well with functional programming principles is separating the communication (of what went wrong) and action (log the error using Logary). 

In Suave's world, it translates to the following

![Log Boundaries](/img/fsharp/series/fstweet/log_boundaries.png)

Inside use case (User Signup, New Tweet, etc.,) boundary, we communicate what went wrong with all the required information that can be helpful to troubleshoot. At the boundary of the application, we check are there any error in the request pipeline and perform the necessary action. 

To pass data between WebPart's in the request pipeline, Suave has a useful property called `userState` in the `HttpContext` record. The `userState` is of type `Map<string, obj>` and we can add custom data to it using the `setUserData` function in the `Writers` module. 

> The `setState` function that we used while [peristing the logged in user]({{< relref "creating-user-session-and-authenticating-user.md#creating-session-cookie">}}) is to perist data in a session (across multiple requests). 

> The `setUserData` function is to pass the data between WebPart's during a request's lifetime and cleared as soon the request has been served. 

## The Communication Side

In this blog post, we are going to take one use case and improve the way we log. 

> Rest of the use cases are left as exercises for you to play with!

Let's improve the log of publish tweet failure

```fsharp
// src/FsTweet.Web/Wall.fs
// ...
  let onPublishTweetFailure (err : PublishTweetError) =
    match err with
    | NotifyTweetError (tweetId, ex) ->
      printfn "%A" ex
      onPublishTweetSuccess tweetId
    | CreateTweetError ex ->
      printfn "%A" ex
      JSON.internalError
// ...
```

The first thing that we need is, for which user this error has occurred.

Let's add a new parameter `user` of type in the `onPublishTweetFailure` function and the pass the user when this function get called

```diff
- let onPublishTweetFailure (err : PublishTweetError) =
+ let onPublishTweetFailure (user : User) (err : PublishTweetError) =
    ...

  let handleNewTweet publishTweet (user : User) ctx = async {
    ...
-     |> AR.either onPublishTweetSuccess onPublishTweetFailure
+     |> AR.either onPublishTweetSuccess (onPublishTweetFailure user)  
    ...
  }
```

The [Message](https://github.com/logary/logary#tutorial-and-data-model) is a core data model in Logary, which is the smallest unit you can log. We can make use of this data model to communicate what went wrong. 

Let's rewrite the `onPublishTweetFailure` function as below


```fsharp
// src/FsTweet.Web/Wall.fs
// ...
module Suave = 
  // ...
  open Logary
  open Suave.Writers
  // ...

  let onPublishTweetFailure (user : User) (err : PublishTweetError) =
    let (UserId userId) = user.UserId
    
    let msg =
      Message.event Error "Tweet Notification Error"
      |> Message.setField "userId" userId

    match err with
    | NotifyTweetError (tweetId, ex) ->
      let (TweetId tId) = tweetId
      msg // Message
      |> Message.addExn ex // Message
      |> Message.setField "tweetId" tId // Message
      |> setUserData "err" // WebPart
      >=> onPublishTweetSuccess tweetId // WebPart
    | CreateTweetError ex ->
      msg
      |> Message.addExn ex // Message
      |> setUserData "err" // WebPart
      >=> JSON.internalError // WebPart

```

We are creating a Logary *Message* of type `Event` with the name `Tweet Notification Error` and set the extra fields using the `Message.setField` function.

We are also adding the actual exception to the *Message* using the `Message.addExn`. Finally we save the `Message` using the `setUserData` function from Suave's Writers module. 

Now we have captured all the required information on the business side. 

### Fixing Logary and Chiron Type Conflict

Both Logary and Chiron has the types `String` and `Objet`. So, if we opened the `Logary` namespace after that of Chiron, F# compiler will treat these types are from the `Logary` libary.

```fsharp
open Chiron
// ...
open Logary
```

So, we have to change the `onPublishTweetSuccess` function as below to let the compiler that we are using these types from the Chiron libary.

```diff
let onPublishTweetSuccess (TweetId id) = 
- ["id", String (id.ToString())]
+ ["id", Json.String (id.ToString())]
  |> Map.ofList
- |> Object
+ |> Json.Object
  |> Json.ok  
```



```bash
E 2017-11-11T16:57:30.7999800+00:00: Tweet Notification Error [Suave]
  errors =>
    -
      hResult => -2146233088
      message => "Error: NameResolutionFailure"
      source => "StreamNet"
      stackTrace => "  at Stream.StreamException.FromResponse (RestSharp.IRestResponse response) [0x00075] in <5158106fb22e4063ad9c9f74906b6f9e>:0
  at Stream.StreamFeed+<AddActivity>d__22.MoveNext () [0x00139] in <5158106fb22e4063ad9c9f74906b6f9e>:0 "
      targetSite => "Stream.StreamException FromResponse(RestSharp.IRestResponse)"
      type => "Stream.StreamException"
  tweetId => "4d1243a4-9098-46c0-94c9-f780fe10bd4c"
  userId => 22
```

```bash
> forge paket add Logary.Targets.SumoLogic \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```