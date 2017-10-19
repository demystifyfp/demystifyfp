---
title: "Adding User Feed"
date: 2017-10-14T08:19:14+05:30
---

Hi, 

Welcome back to the seventeeth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series. 

In the [previous blog post]({{< relref "posting-new-tweet.md">}}), we saw to how to persist a new tweet from the user. But after persisting the new tweet, we haven't do anything. In real twitter we have a user feed, which shows a timeline with tweets from him/her and from others whom he/she follows. 

In this blog post, we are going to address the first part of user's timeline, viewing his/her tweets in the Wall page. 

## Publishing a New Tweet

Earlier, we just created a new tweet in the database when the user submitted a tweet. To add support for user feeds and timeline, we need to notify an external system after persisting the new tweet. 

In other words, it's no longer just create tweet, it's create tweet and notify tweet!

As we did for [orachestrating the user signup]({{< relref "orchestrating-user-signup.md#defining-the-signupuser-function-signature">}}), we define a new function which carry out both of the mentioned operations. 

Let's get started by defining a new type to represent a Tweet!

```fsharp
// FsTweet.Web/Tweet.fs
// ...

type Tweet = {
  UserId : UserId
  PostId : PostId
  Post : Post
}

module Persistence = ...
```

Create a new module `Domain` in *Wall.fs* and define a type for notifying the arrival of a new tweet. 

```fsharp
// FsTweet.Web/Wall.fs

module Domain = 
  open Tweet
  open System
  open Chessie.ErrorHandling 

  type NotifyTweet = Tweet -> AsyncResult<unit, Exception>
```

The `NotifyTweet` type typify a notify tweet function that takes `Tweet` and returns either `unit` or `Exception` asynchronously. 

Then create a new type `PublishTweet` to represent the signature of the orchastration function.

```fsharp
module Domain =
  // ...
  open User

  // ...

  type PublishTweet =
      CreateTweet -> NotifyTweet -> 
        User -> Post -> AsyncResult<TweetId, PublishTweetError>
```

This `PublishTweet` type represents a function that takes two higher order functions, `CreateTweet` to create the tweet in the database and `NotifyTweet` to notify that the user has posted a tweet, the `User` who posts the tweet and the tweet `Post` itself. 

It returns either `TweetId` or `PublishTweetError` asynchronously. 

We don't have the `PublishTweetError` type defined yet. So, let's add it first. 

```fsharp
type PublishTweetError =
| CreateTweetError of Exception
| NotifyTweetError of (TweetId * Exception)

type PublishTweet = ...
```

Finally, implement the `publishTweet` function 

```fsharp
// FsTweet.Web/Wall.fs

module Domain = 
  // ...
  open Chessie

  // ...

  let publishTweet createTweet notifyTweet 
        (user : User) post = asyncTrial {

    let! tweetId = 
      createTweet user.UserId post
      |> AR.mapFailure CreateTweetError

    let tweet = {
      Id = tweetId
      UserId = user.UserId
      Username = user.Username
      Post = post
    }
    do! notifyTweet tweet 
        |> AR.mapFailure (fun ex -> NotifyTweetError(tweetId, ex))

    return tweetId
  }
```

The `publishTweet` function making use of the abstractions that we built earlier and implement the orchastration. 

> We are mapping the possible failure of each operation to its corresponding union case of the `PublishTweetError` type using the `AR.mapFailure` function that we [defined earlier]({{< relref "reorganising-code-and-refactoring.md#revisiting-the-mapasyncfailure-function" >}}). 

There is no function implementing the `NotifyTweet` type yet in our application and our next step is adding it.

## GetStream.IO

To implement newsfeed and timeline we are going to use [GetStream](https://getstream.io/).

The [Stream Framework](https://github.com/tschellenbach/stream-framework/) is a open source solution, which allows you to build scalable news feed, activity streams and notification systems. 

*GetStream.io* is the [SASS](https://en.wikipedia.org/wiki/Software_as_a_service) provider of the stream framework and we are going to use its [free plan](https://getstream.io/pricing/). 

*GetStream.io* has a simple and powerful in-browser [getting started documentation]((https://getstream.io/get_started/)) to get you started right.  Follow this documentation to create an app in *GetStream.io* and get a basic understanding of how it works.

After completing this documentation (roughly take 10-15 minutes), if you navigate to the dashboard, you can find the following UI component

![Get Stream Dashboard](/img/fsharp/series/fstweet/get_stream_dashbord.png)

Keep a of note the App Id, Key, and Secret. We will be using it shortly while integrating it. 

## Configuring GetStream.io

Let's create a new file *Stream.fs* in the web project 

```bash
> forge newFs web -n src/FsTweet.Web/Stream
```

and move it above *Json.fs*

```bash
> repeat 7 forge moveUp web -n src/FsTweet.Web/Stream.fs
```

Then add the [stream-net](https://www.nuget.org/packages/stream-net) nuget package. *stream-net* is a .NET library for building newsfeed and activity stream applications with *Getstream.io*

```bash
> forge paket add stream-net -p src/FsTweet.Web/FsTweet.Web.fsproj
```

To model the configuration parameters that are required to talk to *GetStream.io*, Let's define a record type `Config`. 

```fsharp
// FsTweet.Web/Stream.fs
[<RequireQualifiedAccess>]
module GetStream

type Config = {
  ApiSecret : string
  ApiKey : string
  AppId : string
}
```

We also need a `Client` record type to hold the actual *GetStream.io* client and this config. 

```fsharp
// FsTweet.Web/Stream.fs
// ...
open Stream

type Client = {
  Config : Config
  StreamClient : StreamClient
}
```

To initialize this `Client` type let's add a constructor function. 

```fsharp
let newClient config = {
  StreamClient = 
    new StreamClient(config.ApiKey, config.ApiSecret)
  Config = config
}
```

The final step is creating a new stream client during the application bootstrap. 

```diff
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv = 
   // ...

+  let streamConfig : GetStream.Config = {
+      ApiKey = 
+        Environment.GetEnvironmentVariable "FSTWEET_STREAM_KEY"
+      ApiSecret = 
+        Environment.GetEnvironmentVariable "FSTWEET_STREAM_SECRET"
+      AppId = 
+        Environment.GetEnvironmentVariable "FSTWEET_STREAM_APP_ID"
+  }

+
+  let getStreamClient = GetStream.newClient streamConfig
```

We are getting the required configuration parameters from the respective environment variables populated with the corressponding values in the dashboard that we have seen earlier. 

## Notifying New Tweet

Notifying a new tweet using *GetStrem.io* involves two steps. 

1. Retreiving the [user feed](https://getstream.io/get_started/#flat_feed) of the user.

2. Create [a new activity](https://getstream.io/docs/#adding-activities) of type `tweet` and add it to the user feed. 

To retreive the user feed of the user, let's add a function `userFeed` in 

```fsharp
// FsTweet.Web/Stream.fs
// ...

// Client -> 'a -> StreamFeed
let userFeed getStreamClient userId =
  getStreamClient.StreamClient.Feed("user", userId.ToString())
```

Then in the *Wall.fs*, create a new module `GetStream` and add a new function `notifyTweet` to add a new activity to the user feed. 

```fsharp
// FsTweet.Web/Wall.fs
// ...

module GetStream = 
  open Tweet
  open User
  open Stream
  open Chessie.ErrorHandling

  // GetStream.Client -> Tweet -> AsyncResult<Activity, Exception>
  let notifyTweet (getStreamClient: GetStream.Client) (tweet : Tweet) = 
    
    let (UserId userId) = tweet.UserId
    let (TweetId tweetId) = tweet.Id
    let userFeed =
      GetStream.userFeed getStreamClient userId
    
    let activity = 
      new Activity(userId.ToString(), "tweet", tweetId.ToString())

    // Adding custom data to the activity 
    activity.SetData("tweet", tweet.Post.Value)
    activity.SetData("username", tweet.Username.Value)
    
    userFeed.AddActivity(activity) // Task<Activity>
    |> Async.AwaitTask // Async<Activity>
    |> Async.Catch // Async<Choice<Activity,Exception>>
    |> Async.map ofChoice // Async<Result<Activity,Exception>>
    |> AR // AsyncResult<Activity,Exception>

// ...
```

The `AddActivity` function in the `Activity` (from the `stream-net` library) returns `Task<Activity>` and we are transforming it to `AsyncResult<Activity,Exception>`. 

The `NotifyTweet` type that we defined earlier has the function signature returning `AsyncResult<unit,Exception>` but the implemenation function `notifyTweet` returns `AsyncResult<Activity,Exception>`. 

So, while transforming we need to ignore the `Activity` and map it to `unit` instead. To do it add a new function `mapStreamResponse`

```fsharp
// FsTweet.Web/Wall.fs
// ...
module GetStream = 
  // ...
  let mapStreamResponse response =
    match response with
    | Choice1Of2 _ -> ok ()
    | Choice2Of2 ex -> fail ex
  
  let notifyTweet ... = ...
```

and use this function instead of `ofChoice` in the `notifyTweet` function. 


```diff
let notifyTweet (getStreamClient: GetStream.Client) (tweet : Tweet) = 
    
   ...
  
   userFeed.AddActivity(activity) // Task<Activity>
   |> Async.AwaitTask // Async<Activity>
   |> Async.Catch // Async<Choice<Activity,Exception>>
-  |> Async.map ofChoice // Async<Result<Activity,Exception>>
+  |> Async.map mapStreamResponse // Async<Result<unit,Exception>>
   |> AR // AsyncResult<unit,Exception>
```

Now we have a implementation for notifying when a user tweets. 

## Wiring Up The Presentation Layer

Currently, in the `handleNewTweet` we are justing creating a tweet using the `createTweet` function. To publish the new tweet which does both creating and notifying, we need to change it `publishTweet` and transform its success and failure to `Webpart`.

```diff
// FsTweet.Web/Wall.fs
module Suave =
   ...

-  let onCreateTweetSuccess (PostId id) = 
+  let onPublishTweetSuccess (PostId id) = 
     ...

-  let onCreateTweetFailure (ex : System.Exception) =		 
-    printfn "%A" ex
-    JSON.internalError

+  let onPublishTweetFailure (err : PublishTweetError) =
+    match err with
+    | NotifyTweetError (postId, ex) ->
+      printfn "%A" ex
+      onPublishTweetSuccess postId
+    | CreatePostError ex ->
+      printfn "%A" ex
+      JSON.internalError

-  let handleNewTweet createTweet (user : User) ctx = async {
+  let handleNewTweet publishTweet (user : User) ctx = async {
     ...
        let! webpart = 		         
-          createTweet user.UserId post		 
+          publishTweet user.UserId post
-          |> AR.either onCreateTweetSuccess onCreateTweetFailure
+          |> AR.either onPublishTweetSuccess onPublishTweetFailure
``` 

> For `NotifyTweetError`, we are just printing the error and assumes it as success for simplicity. 

The final piece passing the `publishTweet` dependency to the `handleNewTweet`

```diff
// FsTweet.Web/Wall.fs
module Suave =
    ...
-   let webpart getDataCtx =
+   let webpart getDataCtx getStreamClient =

-    let createTweet = Persistence.createPost getDataCtx 		 
+    let createPost = Persistence.createPost getDataCtx 

+    let notifyTweet = GetStream.notifyTweet getStreamClient
+    let publishTweet = publishTweet createPost notifyTweet

      choose [		      
        path "/wall" >=> requiresAuth (renderWall getStreamClient)
        POST >=> path "/tweets" 
-        >=> requiresAuth2 (handleNewTweet createTweet)  		 
+        >=> requiresAuth2 (handleNewTweet publishTweet)  
```

and then pass the `getStreamClient` from the `main` function.

```diff
// FsTweet.Web/FsTweet.Web.fs
// ...
-      Wall.Suave.webpart getDataCtx 
+      Wall.Suave.webpart getDataCtx getStreamClient
    ]
```