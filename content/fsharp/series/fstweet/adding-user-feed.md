---
title: "Adding User Feed"
date: 2017-10-17T08:19:14+05:30
tags: [suave, rop, chessie, getstream]
---

Hi, 

Welcome back to the seventeenth part of [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}) blog post series. 

In the [previous blog post]({{< relref "posting-new-tweet.md">}}), we saw to how to persist a new tweet from the user. But after persisting the tweet, we haven't do anything. In real twitter, we have a user feed, which shows a timeline with tweets from him/her and from others whom he/she follows. 

In this blog post, we are going to address the first part of user's timeline, viewing his/her tweets on the Wall page. 

## Publishing a New Tweet

Earlier, we just created a new tweet in the database when the user submitted a tweet. To add support for user feeds and timeline, we need to notify an external system after persisting the new tweet. 

As we did for [orchestrating the user signup]({{< relref "orchestrating-user-signup.md#defining-the-signupuser-function-signature">}}), we need to define a new function which carries out both of the mentioned operations. 

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

The `NotifyTweet` typifies a notify tweet function that takes `Tweet` and returns either `unit` or `Exception` asynchronously. 

Then create a new type `PublishTweet` to represent the signature of the orchestration function with its dependencies partially applied.

```fsharp
module Domain =
  // ...
  open User

  // ...

  type PublishTweet = 
    User -> Post -> AsyncResult<TweetId, PublishTweetError>
```

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

The `publishTweet` function is making use of the abstractions that we built earlier and implements the publish tweet logic. 

> We are mapping the possible failure of each operation to its corresponding union case of the `PublishTweetError` type using the `AR.mapFailure` function that we [defined earlier]({{< relref "reorganising-code-and-refactoring.md#revisiting-the-mapasyncfailure-function" >}}). 

There is no function implementing the `NotifyTweet` type yet in our application, and our next step is adding it.

## GetStream.IO

To implement newsfeed and timeline, we are going to use [GetStream](https://getstream.io/).

The [Stream Framework](https://github.com/tschellenbach/stream-framework/) is an open source solution, which allows you to build scalable news feed, activity streams, and notification systems. 

*GetStream.io* is the [SASS](https://en.wikipedia.org/wiki/Software_as_a_service) provider of the stream framework and we are going to use its [free plan](https://getstream.io/pricing/). 

*GetStream.io* has a simple and powerful in-browser [getting started documentation]((https://getstream.io/get_started/)) to get you started right.  Follow this documentation to create an app in *GetStream.io* and get a basic understanding of how it works.

After completing this documentation (roughly take 10-15 minutes), if you navigate to the dashboard, you can find the following UI component

![Get Stream Dashboard](/img/fsharp/series/fstweet/get_stream_dashbord.png)

Keep an of note the App Id, Key, and Secret. We will be using it shortly while integrating it. 

## Configuring GetStream.io

Let's create a new file *Stream.fs* in the web project 

```bash
> forge newFs web -n src/FsTweet.Web/Stream
```

and move it above *Json.fs*

```bash
> repeat 7 forge moveUp web -n src/FsTweet.Web/Stream.fs
```

Then add the [stream-net](https://www.nuget.org/packages/stream-net) NuGet package. *stream-net* is a .NET library for building newsfeed and activity stream applications with *Getstream.io*

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

We are getting the required configuration parameters from the respective environment variables populated with the corresponding values in the dashboard that we have seen earlier. 

## Notifying New Tweet

Notifying a new tweet using *GetStrem.io* involves two steps. 

1. Retreiving the [user feed](https://getstream.io/get_started/#flat_feed).

2. Create [a new activity](https://getstream.io/docs/#adding-activities) of type `tweet` and add it to the user feed. 

To retrieve the user feed of the user, let's add a function `userFeed` in 

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

The `AddActivity` function adds an `Activity` to the user feed and returns `Task<Activity>`, and we are transforming it to `AsyncResult<Activity,Exception>`. 

The `NotifyTweet` type that we defined earlier has the function signature returning `AsyncResult<unit, Exception>` but the implemenation function `notifyTweet` returns `AsyncResult<Activity, Exception>`. 

So, while transforming, we need to ignore the `Activity` and map it to `unit` instead. To do it add a new function `mapStreamResponse`

```fsharp
// FsTweet.Web/Wall.fs
// ...
module GetStream = 
  // ...
  open Chessie.ErrorHandling
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

Now we have an implementation for notifying when a user tweets. 

## Wiring Up The Presentation Layer

Currently, in the `handleNewTweet` function, we are justing creating a tweet using the `createTweet` function. To publish the new tweet which does both creating and notifying, we need to change it to `publishTweet` and then transform its success and failure return values to `Webpart`.

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

> For `NotifyTweetError`, we are just printing the error and assumes it as fire and forget. 

The final piece is passing the `publishTweet` dependency to the `handleNewTweet`

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
        path "/wall" >=> requiresAuth renderWall 
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

Now if you run the app and post a tweet after login, it will be added to the user feed. 

## Subscribing to the User Feed

In the previous section, we have added the server side implementation for adding a `tweet` activity to the user feed and it's time to add it in the client-side.

### Adding GetStream.io JS Library

*GetStream.io* provides a javascript [client library](https://github.com/getstream/stream-js) to enable client-side integration in the browser. 

Download the [minified javascript file](https://raw.githubusercontent.com/GetStream/stream-js/master/dist/js_min/getstream.js) and move it to the *src/FsTweet.Web/assets/js/lib* directory.

```bash
> mkdir src/FsTweet.Web/assets/js/lib

> wget {replace_this_with_actual_URL} \
    -P src/FsTweet.Web/assets/js/lib
```

Then in the *wall.liquid* template, add a reference to this *getstream.fs* file in the `scripts` block. 

```html
<!-- FsTweet.Web/views/user/wall.liquid -->
<!-- ... -->
{% block scripts %}
<script src="/assets/js/lib/getstream.js"> </script>
<!-- ... -->
{% endblock %}
```

### Initializing GetStream.io JS Library

To initialize the `GetStream.io` javascript client, we need *GetStream.io's* API key and App ID. We already have it on the server side, So, we just need to pass it.  

There are two ways we can do it,

1. Exposing an API to retrieve this details.
2. Populate the values in a javascript object while rending the wall page using *Dotliquid*. 

We are going to use the second option as it is simpler. To enable it we first need to pass the `getStreamClient` from the `webpart` function to the `renderWall` function. 

```diff
// FsTweet.Web/Wall.fs
module Suave =

-  let renderWall (user : User) ctx = async {
+  let renderWall 
+     (getStreamClient : GetStream.Client) 
+     (user : User) ctx = async {
   ...

   let webpart getDataCtx getStreamClient =
     ... 
-    path "/wall" >=> requiresAuth renderWall    
+    path "/wall" >=> requiresAuth (renderWall getStreamClient)    
```

Then we need to extend the `WallViewModel` to have two more properties and populate it with the `getStreamClient`'s config values. 


```fsharp
type WallViewModel = {
  // ...
  ApiKey : string
  AppId : string
}

// ...
let renderWall ... =
  // ...
  let vm = {
    // ...
    ApiKey = getStreamClient.Config.ApiKey
    AppId = getStreamClient.Config.AppId}
  // ...
```

The next step is a populating a javascript object with these values in the *wall.liquid* template.

```html
{% block scripts %}
<!-- ... -->
<script type="text/javascript">
  window.fsTweet = {
    stream : {
      appId : "{{model.AppId}}",
      apiKey : "{{model.ApiKey}}"
    }
  }  
</script>
<!-- ... -->
{% endblock %}
```

Finally, in the *wall.js* file, initialize the getstream client with these values. 

```js
// src/FsTweet.Web/assets/js/wall.js
$(function(){
  // ...
  let client = 
    stream.connect(fsTweet.stream.apiKey, null, fsTweet.stream.appId);
});
```

### Adding User Feed Subscription

To initialize a user feed on the client side, *GetStream.io* requires the user id and the user feed token. So, we first need to pass it from the server side. 

As we did for the passing API key and App Id, we first need to extend the view model with the required properties

```fsharp
// src/FsTweet.Web/Wall.fs

module Suave =
  // ...
  type WallViewModel = {
    // ...
    UserId : int
    UserFeedToken : string
  }
  // ...
```

Then populate the view model with the corresponding values

```fsharp
let renderWall ... =
  // ...
  let (UserId userId) = user.UserId
    
  let userFeed = 
    GetStream.userFeed getStreamClient userId

  let vm = {
    // ...
      UserId = userId
      UserFeedToken = userFeed.ReadOnlyToken
    }
  // ...
```

> Note: We are passing the `ReadOnlyToken` as the client side just going to listen to the new tweet. 

Finally, pass the values via *wall.liquid* template.

```html
{% block scripts %}
<!-- ... -->
<script type="text/javascript">
  window.fsTweet = {
    user : {
      id : "{{model.UserId}}",
      name : "{{model.Username}}",
      feedToken : "{{model.UserFeedToken}}"
    },
    // ...
  }  
</script>
<!-- ... -->
{% endblock %}
```

On the client side, use these values to initialize the user feed and subscribe to the new tweet and print to the console. 

```js
// src/FsTweet.Web/assets/js/wall.js
$(function(){
  // ...
  let userFeed = 
    client.feed("user", fsTweet.user.id, fsTweet.user.feedToken);

  userFeed.subscribe(function(data){
    console.log(data.new[0])
  });
});
```

Now if you post a tweet, you will get a console log of the new tweet.
![Console Log of New Tweet](/img/fsharp/series/fstweet/user_tweet_console_log.png)

### Adding User Wall

The last thing that we need to add is rendering the user wall and put the tweets there instead of the console log. To do it, first, we need to have a placeholder on the *wall.liquid* page. 

```html
<!-- FsTweet.Web/views/user/wall.liquid -->
<!-- ... -->
  <div id="wall" />
<!-- ... -->
```

Then add a new file *tweet.js* to render the new tweet in the wall. 

```js
// src/FsTweet.Web/assets/js/tweet.js
$(function(){
  
  var timeAgo = function () {
    return function(val, render) {
      return moment(render(val) + "Z").fromNow()
    };
  }

  var template = `
    <div class="tweet_read_view bg-info">
      <span class="text-muted">
        @{{tweet.username}} - {{#timeAgo}}{{tweet.time}}{{/timeAgo}}
      </span>
      <p>{{tweet.tweet}}</p>
    </div>
  `

  window.renderTweet = function($parent, tweet) {
    var htmlOutput = Mustache.render(template, {
        "tweet" : tweet,
        "timeAgo" : timeAgo
    });
    $parent.prepend(htmlOutput);
  };

});
```

The `renderTweet` function takes the parent DOM element and the tweet object as its inputs. 

It generates the HTML elements of the tweet view using [Mustache](https://mustache.github.io/#demo) and [Moment.js](https://momentjs.com/) (for displaying the time). And then it prepends the created HTML elements to the parents DOM using the jQuery's [prepend](http://api.jquery.com/prepend/) method. 

In the *wall.liquid* file refer this *tweet.js* file 

```html
<!-- FsTweet.Web/views/user/wall.liquid -->
<!-- ... -->
{% block scripts %}
<script src="/assets/js/tweet.js"> </script>
<!-- ... -->
{% endblock %}
```

And then refer the Mustache and Moment.js libraries in the *master_page.liquid*. 

```html
<!-- src/FsTweet.Web/views/master_page.liquid -->
<div id="scripts">
  <!-- ... -->
  <script src="{replace_this_moment_js_CDN_URL}"></script>
  <script src="{replace_this_mustache_js_CDN_URL}"></script>
  <!-- ... -->
</div>
```

Finally, replace the console log with the call to the `renderTweet` function. 


```diff
// src/FsTweet.Web/assets/js/wall.js
  ...
  
  userFeed.subscribe(function(data){
-    console.log(data.new[0]);
+    renderTweet($("#wall"),data.new[0]);
  });

})  
```

Now if we tweet, we can see the wall is being populated with the new tweet.

![User Wall V1](/img/fsharp/series/fstweet/user_feed_v1.png)

We made it!!


## Summary

In this blog post, we learned how to integrate *GetStream.io* in FsTweet to notify the new tweets and also added the initial version of user wall.

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.16)

### Next Part

[Adding User Profile Page]({{<relref "adding-user-profile-page.md">}})