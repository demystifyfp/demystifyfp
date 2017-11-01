---
title: "Fetching Followers and Following Users"
date: 2017-11-01T06:59:48+05:30
draft: true
---

Hi,

Welcome back to the twentieth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series. 

In this blog post, we are going to expose two HTTP JSON endpoints to fetch the list of followers and following users. Then we will be updating the user profile page front-end to consume these APIs and populate the *Following* and *Followers* Tabs.

![](/img/fsharp/series/fstweet/following_users.png)   

![](/img/fsharp/series/fstweet/followers.png) 

## Adding Followers API

Let's get started with the implementation of followers API.

As we did for other persistence logic, let's define a new type to represent the find followers persistence logic.

```fsharp
// src/FsTweet.Web/Social.fs
module Domain =
  // ...
  type FindFollowers = 
    UserId -> AsyncResult<User list, Exception>
// ...
```

The implementation function of this type, will be leverging the [composable queries](http://fsprojects.github.io/SQLProvider/core/composable.html) concept to find the given user id's followers

```fsharp
// src/FsTweet.Web/Social.fs
// ...
module Persistence =
  // ...
  open System.Linq
  // ...

  // GetDataContext -> userId -> 
  //   AsyncResult<DataContext.``public.UsersEntity`` seq, Exception>
  let findFollowers (getDataCtx : GetDataContext) (UserId userId) = asyncTrial {
    let ctx = getDataCtx()

    let selectFollowersQuery = query {
        for s in ctx.Public.Social do
        where (s.FollowingUserId = userId)
        select s.FollowerUserId
    }

    let! followers = 
      query {
        for u in ctx.Public.Users do
        where (selectFollowersQuery.Contains(u.Id))
        select u
      } |> Seq.executeQueryAsync |> AR.catch
      
    return! followers
  }
```

Using the `selectFollowersQuery`, we are first getting the list of followers user ids. Then we are using these ids to the get corressponding user details. 

One thing to notice here is, we are returning a sequence of `DataContext.``public.UsersEntity`` ` on success. But what we want to return is its domain respresentation, a list of `User`. 

Like what we did for [finding the user by username]({{< relref "handling-login-request.md#finding-the-user-by-username">}}), we need to map the all the user entities in the sequence to their respective domain model. 

To do it, we first need to do extract the mapping functionality from the `mapUser` function. 

```fsharp
// 
// ...
module Persistence =
  // ...
  open System

  // DataContext.``public.UsersEntity`` -> Result<User, Exception>
  let mapUserEntityToUser (user : DataContext.``public.UsersEntity``) = 
    let userResult = trial {
      let! username = Username.TryCreate user.Username
      let! passwordHash = PasswordHash.TryCreate user.PasswordHash
      let! email = EmailAddress.TryCreate user.Email
      let userEmailAddress =
        match user.IsEmailVerified with
        | true -> Verified email
        | _ -> NotVerified email
      return {
        UserId = UserId user.Id
        Username = username
        PasswordHash = passwordHash
        EmailAddress = userEmailAddress
      } 
    }
    userResult
    |> mapFailure Exception

  //...
```

This extracted method returns `Result<User, Exception>` and then modify the `mapUser` function to use this function.

```fsharp
module Persistence =
  // ...
  let mapUserEntityToUser ... = ...
  
  // DataContext.``public.UsersEntity`` -> AsyncResult<User, Exception>
  let mapUser (user : DataContext.``public.UsersEntity``) = 
    mapUserEntityToUser user
    |> Async.singleton
    |> AR

  // ...
```

I just noticed that the name `mapUser` misleading. So, rename it to `mapUserEntity` to clearly communicate what it does.

```diff
module Persistence =
  ...
- let mapUser (user : DataContext.``public.UsersEntity``) =   
+ let mapUserEntity (user : DataContext.``public.UsersEntity``) =   
  ...

  let findUser ... = asyncTrial {
    ...
-     let! user = mapUser user 
+     let! user = mapUserEntity user
  }
```

The next step is transforming a sequence of `DataContext.``public.UsersEntity`` ` to a list of `User`.

```fsharp
let mapUserEntities (users : DataContext.``public.UsersEntity`` seq) =
  users // DataContext.``public.UsersEntity`` seq
  |> Seq.map mapUserEntityToUser // Result<User, Exception> seq
  // TODO
```

The next step is to transform `Result<User, Exception> seq` to `Result<User list, Exception>`. 

> As *Chessie* library already supports the failure side of the `Result` as a list, we don't specify the failure side as `Exception list`.

To do this transformation, Chessie library provides a function called `collect`.

```fsharp
let mapUserEntities (users : DataContext.``public.UsersEntity`` seq) =
  users // DataContext.``public.UsersEntity`` seq
  |> Seq.map mapUserEntityToUser // Result<User, Exception> seq
  |> collect // Result<User list, Exception>
  // TODO
```

We are not done yet as the failure side is still a list of Exception but what we want is single Exception. .NET already supports this through [AggregateException](https://msdn.microsoft.com/en-us/library/system.aggregateexception(v=vs.110).aspx). 

```fsharp
// DataContext.``public.UsersEntity`` seq -> 
//  AsyncResult<User list, Exception>
let mapUserEntities (users : DataContext.``public.UsersEntity`` seq) =
  users // DataContext.``public.UsersEntity`` seq
  |> Seq.map mapUserEntityToUser // Result<User, Exception> seq
  |> collect // Result<User list, Exception>
  |> mapFailure 
      (fun errs -> new AggregateException(errs) :> Exception)
      // Result<User list, Exception>
  |> Async.singleton // Async<Result<User list, Exception>>
  |> AR // AsyncResult<User list, Exception>
```

Using the `mapFailure` function from Chessie, we are tranforming the list of exceptions into an `AggregateException` and then we are mapping it to `AsyncResult<User list, Exception>`.

With this `mapUserEntities` function in place, we can now return a `User list` in the `findFollowers` function

```diff
module Persistence =
  ...
+ open User.Persistence
  ...

  let findFollowers ... = asyncTrail {
    ...
-   return! followers  
+   return! mapUserEntities followers
  } 
```

Now we have the persitence layer ready. 

The JSON response that we are going to send will have the following structure

```json
{
  "users": [
    {
      "username": "tamizhvendan"
    }
  ]
}
```

> To keep it simple, we are just returning the username of the users.

To model the corresponding server side representation of this JSON object, let's add some types along with the static member function `ToJson` which is required by the Chiron library to serialize the type to JSON.

```fsharp
// src/FsTweet.Web/Social.fs
// ...
module Suave =
  // ...

  type UserDto = {
    Username : string
  } with
   static member ToJson (u:UserDto) = 
      json { 
          do! Json.write "username" u.Username
      }

  type UserDtoList = UserDtoList of (UserDto list) with
    static member ToJson (UserDtoList userDtos) = 
      let usersJson = 
        userDtos
        |> List.map (Json.serializeWith UserDto.ToJson)
      json {
        do! Json.write "users" usersJson
      }

  let mapUsersToUserDtoList (users : User list) =
    users
    |> List.map (fun user -> {Username = user.Username.Value})
    |> UserDtoList

  // ...
```

To expose the `findFollowers` function as a HTTP API, we first need to specify what we need to do for both success and failure.

```fsharp
module Suave =
  // ...
  let onFindUsersFailure (ex : System.Exception) =
    printfn "%A" ex
    JSON.internalError

  let onFindUsersSuccess (users : User list) =
    mapUsersToUserDtoList users
    |> Json.serialize
    |> JSON.ok
  // ...
```

Then add a new function which handles the request for fetching user's followers

```fsharp
// FindFollowers -> int -> WebPart
let fetchFollowers (findFollowers: FindFollowers) userId ctx = async {
  let! webpart =
    findFollowers (UserId userId)
    |> AR.either onFindUsersSuccess onFindUsersFailure
  return! webpart ctx
}
```

Finally, add the route for the HTTP endpoint.

```diff
  let webpart getDataCtx getStreamClient =
    ...
-   POST >=> path "/follow" >=> requiresAuth2 handleFollowUser
+   let findFollowers = findFollowers getDataCtx
+   choose [
+     GET >=> pathScan "/%d/followers" (fetchFollowers findFollowers)
+     POST >=> path "/follow" >=> requiresAuth2 handleFollowUser
+   ] 
```

## Adding Following Users API

The API to serve the list of users being followed by the given user follows the similar structure except the actual backend query

```fsharp
// src/FsTweet.Web/Social.fs
module Domain = 
  // ...
  type FindFollowingUsers = UserId -> AsyncResult<User list, Exception>

module Persistence =
  // ...
  let findFollowingUsers (getDataCtx : GetDataContext) (UserId userId) = asyncTrial {
    let ctx = getDataCtx()

    let selectFollowingUsersQuery = query {
        for s in ctx.Public.Social do
        where (s.FollowerUserId = userId)
        select s.FollowingUserId
    }

    let! followingUsers = 
      query {
        for u in ctx.Public.Users do
        where (selectFollowingUsersQuery.Contains(u.Id))
        select u
      } |> Seq.executeQueryAsync |> AR.catch

    return! mapUserEntities followingUsers
  }
```

In the `selectFollowingUsersQuery`, we are selecting the list of user ids that are being followed by the provided user id.

Like `fetchFollowers`, we just have to add `fetchFollowingUsers` function and expose it in a new HTTP route

```fsharp
module Suave =
  // ...

  // FindFollowingUsers -> int -> FindFollowingUsers
  let fetchFollowingUsers (findFollowingUsers: FindFollowingUsers) userId ctx = async {
    let! webpart =
      findFollowingUsers (UserId userId)
      |> AR.either onFindUsersSuccess onFindUsersFailure
    return! webpart ctx
  }
```

```diff
  let webpart getDataCtx getStreamClient =
    ...
    let findFollowers = findFollowers getDataCtx
+   let findFollowingUsers = findFollowingUsers getDataCtx    
    choose [
      GET >=> pathScan "/%d/followers" (fetchFollowers findFollowers)
+     GET >=> pathScan "/%d/following" (fetchFollowingUsers findFollowingUsers)
      POST >=> path "/follow" >=> requiresAuth2 handleFollowUser
    ] 
```

Now we both the endpoints are up and running.

## Updating UI

To consume these two APIs and rendering it on the client side, we need to update the *social.fs*

```js
// src/FsTweet.Web/assets/js/social.js
$(function(){
  // ...
  var usersTemplate = `
    {{#users}}
      <div class="well user-card">
        <a href="/{{username}}">@{{username}}</a>
      </div>
    {{/users}}`;

  
  function renderUsers(data, $body, $count) {
    var htmlOutput = Mustache.render(usersTemplate, data);
    $body.html(htmlOutput);
    $count.html(data.users.length);
  }

  (function loadFollowers () {
    var url = "/" + fsTweet.user.id  + "/followers"
    $.getJSON(url, function(data){
      renderUsers(data, $("#followers"), $("#followersCount"))
    })
  })();

  (function loadFollowingUsers() {
    var url = "/" + fsTweet.user.id  + "/following"
    $.getJSON(url, function(data){
      renderUsers(data, $("#following"), $("#followingCount"))
    })
  })();
});
```

Using jQuery's [getJSON](http://api.jquery.com/jquery.getjson/) function, we are fetching the JSON object and then rendering it using [Mustache](https://mustache.github.io/#demo) template.

That's it!

## Summary

In this blog post, we have exposed two HTTP APIs to retrieve the list of followers and following users. 

As we saw in other posts, we are just doing transformations to achieve what we want. In the process we are creating some useful abstractions (like what we did here for `mapUserEntityToUser` function) which in turn helping us to deliver the features faster (like `AR.either` function). 

With this we are done with all the features that will be part of this initial version of FsTweet. In the upcoming posts, we are going to add support of logging and learn how to deploy.

As usual, the source code of this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.19)
