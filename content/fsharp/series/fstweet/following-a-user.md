---
title: "Following a User"
date: 2017-10-28T05:06:53+05:30
tags : [suave, SQLProvider, fsharp, chessie, getstream]
---

Hello!

We are on our way to complete the blog post series on [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}). 

In this nineteenth part, we are going to implement the core feature of Twitter, Following other users and viewing their tweets on his/her wall page.  

## Adding Log out

To test drive the implementation of following a user in FsTweet, we may need to log out and log in as a different user. But we haven't added the logout functionality yet. 

So, as part of this feature implementation, let's get started with implementing log out. 

The log out functionality is more straightforward to implement. Thanks to the `deauthenticate` WebPart from the `Suave.Authentication` module which clears both the authentication and the state cookie. After removing the cookies, we just need to redirect the user to the login page.

Let's add a new path `/logout` in *Auth.fs* and handle the logout request as mentioned.

```diff
// src/FsTweet.Web/Auth.fs
...
module Suave =
   ...

   let webpart getDataCtx =
     let findUser = Persistence.findUser getDataCtx
-    path "/login" >=> choose [
-      GET >=> mayRequiresAuth (renderLoginPage emptyLoginViewModel)
-      POST >=> handleUserLogin findUser
+    choose [
+      path "/login" >=> choose [
+        GET >=> mayRequiresAuth (renderLoginPage emptyLoginViewModel)
+        POST >=> handleUserLogin findUser
+      ]
+      path "/logout" >=> deauthenticate >=> redirectToLoginPage
     ]
```

## Following A User

Let's get started by creating a new file *Social.fs* in the *FsTweet.Web* project and move it above *UserProfile.fs*

```bash
> forge newFs web -n src/FsTweet.Web/Social

> repeat 2 forge moveUp web -n src/FsTweet.Web/Social.fs
```

The backend implementation of following a user involves two things. 

1. Persisting the social connection (following & follower) in the database.

2. Subscribing to the other user's twitter feed.

As we did for the other features, let's add a `Domain` module and orchestrate this functionality. 

```fsharp
// FsTweet.Web/Social.fs
namespace Social

module Domain = 
  open System
  open Chessie.ErrorHandling
  open User

  type CreateFollowing = User -> UserId -> AsyncResult<unit, Exception>
  type Subscribe = User -> UserId -> AsyncResult<unit, Exception>
  type FollowUser = User -> UserId -> AsyncResult<unit, Exception>

  // Subscribe -> CreateFollowing -> 
  //  User -> UserId -> AsyncResult<unit, Exception>
  let followUser 
    (subscribe : Subscribe) (createFollowing : CreateFollowing) 
    user userId = asyncTrial {

    do! subscribe user userId
    do! createFollowing user userId
  } 
``` 

The `CreateFollowing` and the `Subscribe` types represent the function signatures of the two tasks that we need to do while following a user. 

The next step is defining functions which implement these two functionalities.

### Persisting the social connection

To persist the social connection, we need to have a new table. So, As a first step, let's add a migration (script) to create this new table. 

```fsharp
// src/FsTweet.Db.Migrations/FsTweet.Db.Migrations.fs
// ...

[<Migration(201710280554L, "Creating Social Table")>]
type CreateSocialTable()=
  inherit Migration()

  override this.Up() =
    base.Create.Table("Social")
      .WithColumn("Id").AsGuid().PrimaryKey().Identity()
      .WithColumn("FollowerUserId").AsInt32().ForeignKey("Users", "Id").NotNullable()
      .WithColumn("FollowingUserId").AsInt32().ForeignKey("Users", "Id").NotNullable()
    |> ignore

    base.Create.UniqueConstraint("SocialRelationship")
      .OnTable("Social")
      .Columns("FollowerUserId", "FollowingUserId") |> ignore
  
  override this.Down() = 
    base.Delete.Table("Tweets") |> ignore
```

Then run the application, and the fluent migrator creates this table in the database.

Make sure to verify the underlying schema using *psql*.

![Social Table](/img/fsharp/series/fstweet/social_table_schema.png)

The next step is defining the function which persists the social connection in this table. 

Create a new module `Persistence` in the *Social.fs* file and define the `createFollowing` function as below

```fsharp
// FsTweet.Web/Social.fs
// ...
module Persistence =
  open Database
  open User

  // GetDataContext -> User -> UserId -> AsyncResult<unit, Exception>
  let createFollowing (getDataCtx : GetDataContext) (user : User) (UserId userId) = 
     
     let ctx = getDataCtx ()
     let social = ctx.Public.Social.Create()
     let (UserId followerUserId) = user.UserId
      
     social.FollowerUserId <- followerUserId
     social.FollowingUserId <- userId

     submitUpdates ctx
```

We are using the term `follower` to represent the current logged in user and the `following user` to represent the user that the logged in user about to follow. 

### Subscribing to the User Feed

The second task is subscribing to the user feed so that the follower will be getting the tweets from the users he/she is following.

As we did for [notifying a new tweet]({{< relref "adding-user-feed.md#notifying-new-tweet">}}), let's create a new module `GetStream` and add the `subscribe` function.

```fsharp
// FsTweet.Web/Social.fs
// ...
module GetStream =
  open User
  open Chessie

  // GetStream.Client -> User -> UserId -> AsyncResult<unit, Exception>
  let subscribe (getStreamClient : GetStream.Client) (user : User) (UserId userId) = 
    let (UserId followerUserId) = user.UserId

    let timelineFeed = 
      GetStream.timeLineFeed getStreamClient followerUserId
    let userFeed =
      GetStream.userFeed getStreamClient userId

    timelineFeed.FollowFeed(userFeed) // Task
    |> Async.AwaitTask // Async<uint>
    |> AR.catch // AsyncResult<unit, Exception>
```

In *GetStream.io*'s [vocabulary](https://getstream.io/get_started/#follow), following a user means, getting the **timeline feed** of the follower and [follow the other user](https://getstream.io/docs/#following) using this timeline feed.

### The Presentation Layer on Server Side

In the last three sections, we built the internal pieces that are required to follow a user. The final step is wiring the parts together with the presentation layer and expose an HTTP endpoint to carry out the functionality.

Let's start with defining the sample JSON that the *follow user* endpoint should support. 

```json
{
  "userId" : 123
}
```

Then add a server-side type to represent this JSON request body.

```fsharp
// FsTweet.Web/Social.fs
// ...
module Suave =
  open Chiron

  type FollowUserRequest = FollowUserRequest of int with 
    static member FromJson (_ : FollowUserRequest) = json {
        let! userId = Json.read "userId"
        return FollowUserRequest userId 
      }

```

If following a user operation is successful, we need to return *204 No Content*, and if it is a failure, we have to print the actual exception details to the console and return *500 Internal Server Error*. 

```fsharp
// FsTweet.Web/Social.fs
// ...
module Suave =
  // ...
  open Suave
  // ...

  let onFollowUserSuccess () =
    Successful.NO_CONTENT

  let onFollowUserFailure (ex : System.Exception) =
    printfn "%A" ex
    JSON.internalError
```

Then we have to define the request handler which handles the request to follow the user.

```fsharp
module Suave =
  // ...
  open Domain
  open User
  open Chessie
  // ...

  // FollowUser -> User -> WebPart
  let handleFollowUser (followUser : FollowUser) (user : User) ctx = async {
    match JSON.deserialize ctx.request with
    | Success (FollowUserRequest userId) -> 
      let! webpart =
        followUser user (UserId userId)
        |> AR.either onFollowUserSuccess onFollowUserFailure
      return! webpart ctx
    | Failure _ -> 
      return! JSON.badRequest "invalid user follow request" ctx
  }
```  

The `handleFollowUser` function deserializes the request to `FollowUserRequest` using the `deserialize` function that we defined earlier in the *Json.fs* file. If deserialization fails, we are returning bad request. For a valid request,  we are calling the `followUser` function and maps its success and failure results to `WebPart`. 

The last piece is wiring this handler with the `/follow` endpoint. 

```fsharp
// FsTweet.Web/Social.fs
// ...
module Suave =
  // ...
  open Suave.Filters
  open Persistence
  open Domain
  open Suave.Operators
  open Auth.Suave

  // ...

  let webpart getDataCtx getStreamClient =
    
    let createFollowing = createFollowing getDataCtx
    let subscribe = GetStream.subscribe getStreamClient
    let followUser = followUser subscribe createFollowing

    let handleFollowUser = handleFollowUser followUser
    POST >=> path "/follow" >=> requiresAuth2 handleFollowUser
```

```diff
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  // ...
  let app = 
    choose [
      // ...
+      Social.Suave.webpart getDataCtx getStreamClient
       UserProfile.Suave.webPart getDataCtx getStreamClient
    ]
  // ...
```

### The Presentation Layer on Client Side

Now the backend is capable of handling the request to follow a user, and we have to update our front-end code to release this new feature. 

To follow a user, we need his/her user id. To retrieve it on the client-side, let's add a [data attribute](https://developer.mozilla.org/en-US/docs/Learn/HTML/Howto/Use_data_attributes) to the `follow` button in the *profile.liquid* template.

```diff
// views/user/profile.liquid

- <a id="follow">Follow</a>
+ <a id="follow" data-user-id="{{model.UserId}}">Follow</a>
``` 

> We are already having the user id of the profile being viewed as a global variable `fsTweet.user.id` in the JS side. This approach is to demonstrate another method to share data between client and server. 

Then add a new javascript file *social.js* which handles the client side activities for following a user.

```bash
> touch src/FsTweet.Web/assets/js/social.js
```

```js
// assets/js/social.js
$(function(){
  $("#follow").on('click', function(){
    var $this = $(this);
    var userId = $this.data('user-id');
    $this.prop('disabled', true);
    $.ajax({
      url : "/follow",
      type: "post",
      data: JSON.stringify({userId : userId}),
      contentType: "application/json"
    }).done(function(){
      alert("successfully followed");
      $this.prop('disabled', false);
    }).fail(function(jqXHR, textStatus, errorThrown) {
      console.log({
        jqXHR : jqXHR, 
        textStatus : textStatus, 
        errorThrown: errorThrown});
      alert("something went wrong!")
    });
  });
});
```

This javascript snippet fires an AJAX Post request with the user id using jQuery upon clicking the follow button and it shows an alert for both success and failure cases of the response. 

That's it! We can follow a user, by clicking the follow button in his/her profile page.  

### Revisiting User Wall

In the current implementation, the user's wall page has subscribed only to the logged in user's feed. This subscription will populate just if the user posts a tweet. So, the Wall page will be empty most of the cases.

Ideally, it should display the user's timeline where he/she can see the tweets from his/her followers. And also, we need a real-time update when the timeline receives a new tweet from the follower. 

*GetStream.io*'s javascript client library already supports these features. So, we just have to enable it.

As a first step, in addition to passing the user feed token, we have to share the timeline token. 

Let's add a new function in *Stream.fs* to get an user's timeline feed.

```fsharp
// src/FsTweet.Web/Stream.fs
let timeLineFeed getStreamClient (userId : int) =
  getStreamClient.StreamClient.Feed("timeline", userId.ToString())
```

Then update the view model of the Wall page with a new property `TimelineToken` and update this property with the read-only token of the user's timeline feed.

```diff
// src/FsTweet.Web/Wall.fs

...

   type WallViewModel = {
    ...
+   TimelineToken : string
    ...}		  

...

+
+    let timeLineFeed =
+      GetStream.timeLineFeed getStreamClient userId 

  let vm = {
    ...
+   TimelineToken = timeLineFeed.ReadOnlyToken
    ...}
```

To pass this `Timeline` token with the javascript code, add a new property `timelineToken` in the `fsTweet.user` object in the *wall.liquid* template. 

```diff
<!-- views/user/wall.liquid -->

<script type="text/javascript">
  window.fsTweet = {
    user : {
      ...
+     timelineToken : "{{model.TimelineToken}}"
    },
    stream : {...}
  }
```

The last step is initializing a timeline feed using this token and subscribe to it. 

```js
// assets/js/wall.js
$(function(){
  // ...
  let timelineFeed = 
    client.feed("timeline", fsTweet.user.id, fsTweet.user.timelineToken);

  timelineFeed.subscribe(function(data){
    renderTweet($("#wall"),data.new[0]);
  });
});
```

This would update the wall page when the timeline feed receives a new tweet. 

To have the wall page with a populate timeline, we need to fetch the tweets from the timeline feed just like what we did for getting the user's tweet on the user profile page. 

```js
// assets/js/wall.js
$(function(){
  // ...
  timelineFeed.get({
    limit: 25
  }).then(function(body) {
    $(body.results.reverse()).each(function(index, tweet){
      renderTweet($("#wall"), tweet);
    });
  });
});
```

In *GetStream.io*, the timeline feed of a user will not have the user's tweets. So, the populated wall page here will not have user's tweet. To show both the user's tweets and his/her timeline tweets, we can fetch the user's tweets as well and merge both the feeds and then sort with time.

To do it, replace the above snippet with the below one

```js
// assets/js/wall.js
$(function(){
  // ...
  timelineFeed.get({
    limit: 25
  }).then(function(body) {
    var timelineTweets = body.results
    userFeed.get({
      limit : 25
    }).then(function(body){
      var userTweets = body.results
      var allTweets = $.merge(timelineTweets, userTweets)
      allTweets.sort(function(t1, t2){
        return new Date(t2.time) - new Date(t1.time);
      })
      $(allTweets.reverse()).each(function(index, tweet){
        renderTweet($("#wall"), tweet);
      });
    })
  })
});
```

Cool! 

Now run the app, open two browser windows, log in as two different users and follow the other user.  
![User Wall With Live Update](/img/fsharp/series/fstweet/following_a_user.gif)

After following the other user, you can get the live updates. 

![User Wall With Live Update](/img/fsharp/series/fstweet/user_wall_live_update.gif)

We made it!

## Showing Following In User Profile

Currently, In the user profile page, we are always showing *Follow* button, even if the logged in user already following the given user. 

As we have added support for following a user, while rendering the user profile page, we can now check whether the logged in user follows the given user or not and show either the *follow* button or *following* button accordingly. 

To enable this, let's get add a new type `UserProfileType` to represent all the three possible cases while serving the user profile page.

```fsharp
// src/FsTweet.Web/UserProfile.fs
// ...
type UserProfileType =
| Self
| OtherNotFollowing
| OtherFollowing

// ...
```

Then we need to use this type in the place of the `IsSelf` property. 

```diff
type UserProfile = {
   User : User
   GravatarUrl : string
-  IsSelf : bool
+  UserProfileType : UserProfileType
}
```

Now we are getting a set of compiler warnings, showing us the directions of the places where we have to go and fix this property change.  

The first place that we need to fix is the `newProfile` function. Let's change it to accept a one more parameter `userProfileType` and use it to set `UserProfileType` of the new user profile.

```diff
- let newProfile user = {
+ let newProfile userProfileType user = { 
    User = user
    GravatarUrl = gravatarUrl user.EmailAddress
-   IsSelf = false
+   UserProfileType = userProfileType
  }
```

Then in the places where we are calling this `newProfile` function, pass the appropriate user profile type. 

```diff
  match loggedInUser with
  | None -> 
     let! userMayBe = findUser username
-    return Option.map newProfile userMayBe
+    return Option.map (newProfile OtherNotFollowing) userMayBe
  | Some (user : User) -> 
    if user.Username = username then
      let userProfile = 
-       {newProfile user with IsSelf = true}
+       newProfile Self user
      return Some userProfile
    else  
      let! userMayBe = findUser username
-     return Option.map newProfile userMayBe
+     return Option.map (newProfile OtherNotFollowing) userMayBe
```

For an anonymous user, the user profile will always be other whom he/she is not following. But for a logged in user who is viewing an another user's profile, we need to check the `Social` table and set the type to either `OtherNotFollowing` or `OtherFollowing`. 

Let's keep it as `OtherNotFollowing` for the time being and we'll implement this check shortly. 

The next place that we need to fix is where we are populating the `UserProfileViewModel`. To do it, we first have to add a new property `IsFollowing` in the view model. 

```fsharp
type UserProfileViewModel = {
  // ...
  IsFollowing : bool
}
```

And then in the `newUserProfileViewModel` function, populate this and the `IsSelf` property from the `UserProfileType`. 

```fsharp
let newUserProfileViewModel ... =
  // ...
  let isSelf, isFollowing = 
    match userProfile.UserProfileType with
    | Self -> true, false
    | OtherFollowing -> false, true
    | OtherNotFollowing -> false, false
  
  {
    // ...
    IsSelf = isSelf
    IsFollowing = isFollowing
  }
```

Now we are right except the *following* check. The last piece that we need to change before implementing this check is updating the *profile.liquid* show either follow or following link based on the `IsFollowing` property.

```diff
<!-- views/user/profile.liquid -->
<!-- ... -->

{% unless model.IsSelf %}
-  <a href="#" id="follow">Follow</a>
+  {% if model.IsFollowing %}
+    <a href="#" id="unfollow">Following</a>
+  {% else %}
+    <a href="#" id="follow" data-user-id="{{model.UserId}}">Follow</a>
+  {% endif %}
{% endunless %}

```

Great! Now it's time to implement the `isFollowing` check. 

### Implementing The IsFollowing Check

Let's get started by defining a type for this check in the *Social.fs*'s `Domain` module.

```fsharp
// src/FsTweet.Web/Social.fs
module Domain =
  // ...
  type IsFollowing = 
    User -> UserId -> AsyncResult<bool, Exception>
// ...
```

With this type in place, we can now change the `findUserProfile` to accept a new parameter `isFollowing` of this type and use it to figure out the actual `UserProfileType`.

```fsharp
module Domain =
  // ...
  open Social.Domain
  // ...

  let findUserProfile 
    ... (isFollowing : IsFollowing) ...  = asyncTrial {
    match loggedInUser with
    | None -> // ...
    | Some (user : User) -> 
      // ...
      else  
        // ...
        match userMayBe with
        | Some otherUser -> 
          let! isFollowingOtherUser = 
            isFollowing user otherUser.UserId
          let userProfileType =
            if isFollowingOtherUser then
              OtherFollowing
            else OtherNotFollowing 
          let userProfile = 
            newProfile userProfileType otherUser
          return Some userProfile
        | None -> return None
  }
```


Then add the implementation function `isFollowing` in the `Persistence` module

```fsharp
// src/FsTweet.Web/Social.fs
// ...
module Persistence =
  // ...
  open Chessie.ErrorHandling
  open FSharp.Data.Sql
  open Chessie
  // ...

  let isFollowing (getDataCtx : GetDataContext) 
        (user : User) (UserId userId) = asyncTrial {

    let ctx = getDataCtx ()
    let (UserId followerUserId) = user.UserId

    let! connection = 
      query {
        for s in ctx.Public.Social do
          where (s.FollowerUserId = followerUserId && 
                  s.FollowingUserId = userId)
      } |> Seq.tryHeadAsync |> AR.catch

    return connection.IsSome
  }
// ...
```

The logic is straight-forward, we retrieve the social connection by providing both the follower user id and following user's user id. If the relationship exists we return `true`, else we return `false`. 

Then we need to pass this function after partially applied the first parameter (`getDataCtx`) to the `findUserProfile` function.

```diff
let webpart (getDataCtx : GetDataContext) getStreamClient = 
  let findUser = Persistence.findUser getDataCtx
- let findUserProfile = findUserProfile findUser
+ let isFollowing = Persistence.isFollowing getDataCtx
+ let findUserProfile = findUserProfile findUser isFollowing
  // ...
```

That's it. Now if we run the application and views a profile that we are following, we will be seeing the *following* button instead of the *follow* button.

![User Profile V3](/img/fsharp/series/fstweet/following_user.png)

## Summary

We covered a lot of ground in this blog post. We started with adding log out and then we moved to adding support for following the user. Then we updated the wall page to show the timeline, and finally we revisited the user profile page to reflect the social connection status. 

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.18)


## Exercise

* It'd be great if we can get an email notification when someone follows us in FsTweet.

* How about adding the support for unfollowing a user?