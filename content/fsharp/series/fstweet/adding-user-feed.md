---
title: "Adding User Feed"
date: 2017-10-14T08:19:14+05:30
draft: true
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

The `NotifyTweet` type typify a notify tweet function that takes `Tweet` and returns either `uint` or `Exception` asynchronously. 

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



```bash
> forge paket add stream-net -p src/FsTweet.Web/FsTweet.Web.fsproj
> forge newFs web -n src/FsTweet.Web/Stream
> repeat 7 forge moveUp web -n src/FsTweet.Web/Stream.fs
```
