---
title: "Adding Logs using Logary"
date: 2017-11-11T16:37:49+05:30
draft: true
---

Hi!

Welcome Back!!

In this twenty second part of [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}) blog post series, we are going to improve how we are logging the exceptions in FsTweet. 


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

So, we have to change the `onPublishTweetSuccess` function as below to let the compiler know that we are using these types from the Chiron libary.

```diff
let onPublishTweetSuccess (TweetId id) = 
- ["id", String (id.ToString())]
+ ["id", Json.String (id.ToString())]
  |> Map.ofList
- |> Object
+ |> Json.Object
  |> Json.ok  
```

## The Action Side

The Action side of logging involves, initialzing Logary's logger during the application bootstrap and log using it if there is any error in the request pipeline


### Initializing Logary

 A remarkable feature of Logary is its ability to support multiple targets for the log. We can conifigure it to write the log on Console, [RabbitMQ](https://www.rabbitmq.com/), [LogStash](https://www.elastic.co/products/logstash) and [much more](https://github.com/logary/logary#overview).

 For our case, we are going with the simpler option, Console.

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
// ...
open Logary.Configuration
open Logary
open Logary.Targets

// ...

let main argv =
  // ...

  // LogaryConf -> LogaryConf
  let target = 
    withTarget (Console.create Console.empty "console")

  // LogaryConf -> LogaryConf
  let rule = 
    withRule (Rule.createForTarget "console")

  // LogaryConf -> LogaryConf
  let logaryConf = 
    target >> rule

  // ...
```

* Target specifies where to log. We are using the `Console.create` factory function from the `Logary.Targets` module to create the Console target. The last argument `"console"` is the name of the target which can be any arbitary string.

* The Rule specifies when to log. Here we are specifying to log for all the cases. (We can configure it to log only Fatal or Error alone)

* The `logaryConf` composes the target and the rule into single configuration using the [function composition](https://fsharpforfunandprofit.com/posts/function-composition/) operator

The next step is initializing the logger using this configuration.

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
// ...
open Hopac

// ...

let main argv =
  // ...

  use logary =
    withLogaryManager "FsTweet.Web" logaryConf |> run

  let logger =
    logary.getLogger (PointName [|"Suave"|])

  // ...
```

Logary uses [Hopac's Job](https://github.com/Hopac/Hopac) with [Actor model](https://en.wikipedia.org/wiki/Actor_model) behind the scenes to log the data in the Targets without the blocking the caller. You can think of this as a lightweight [Thread](https://docs.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/threading/) running parallely along with the main program. If there is anything to log, we just need to give it this Hopac Job and we can move on without waiting for it to complete. 

Here we are initializing the logaryManager with a name and the configuration and asking it to `run` parallely. 

Then we get a logger instance by providing the [PointName](https://github.com/logary/logary#pointname), a location where you send the log message from.

### Wiring Logary With Suave

The final piece that we need to work on is to check is there any error in the request pipeline and log it using the logger (that we just created) if we found one.

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
// ...

// HttpContext -> string -> 'value option
let readUserState ctx key : 'value option =
  ctx.userState 
  |> Map.tryFind key 
  |> Option.map (fun x -> x :?> 'value)

// Logger -> WebPart
let logIfError (logger : Logger) ctx = 
  readUserState ctx "err" // Message option
  |> Option.iter logger.logSimple // unit
  succeed // WebPart

let main argv = 
  // ...
```

In the `readUserState` function, we are trying to find an `obj` with the provided `key` in the `userState` property of `HttpContext`. If the `obj` does exists, we are [downcasting](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/casting-and-conversions-%5Bfsharp%5D) it to a generic type `'value`.  

The `logIfError` function, takes an instance of `Logger` and uses `readUserState` function to find the error log Message and log it using the `logSimple` function from Logary. The `succeed` is a in-built WebPart from Suave 

The last step is wiring this `logIfError` function with the request pipeline

```diff
let main argv = 
  ...
  let logger = ...
  ...
  let app = ...
  ...
- startWebServer serverConfig app

+ let appWithLogger = 
+   app >=> context (logIfError logger)

+ startWebServer serverConfig appWithLogger
```

Awesome. The action to perform the actual logging is completely de-coupled!

Now if we run the application, and post a tweet with internet connection down, we get the following log

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

Better and actionable log, isn't it?

## Summary

We just scratched the surface of the Logary libary in this blog post and we can make the logs even more robust by leveraging other features from the Logary's kitty. 

Apart from Logary, An another take away is how we sepearated the communication and action aspects of logging. This separation enabled us to perform the logging outside of the business domain (at the edge of the application boundary) and we didn't passed the logger as a dependency from `main` function to the downstream `webpart` functions. 

The source code associated with this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.21)

### Next Part

[Wrapping Up]({{<relref "wrapping-up.md">}})