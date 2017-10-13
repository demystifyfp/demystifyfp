---
title: "Posting New Tweet"
date: 2017-10-09T19:51:48+05:30
tags: [fsharp, suave, chiron, chessie, rop, FluentMigrator]
---

Hi there!

In this sixteenth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series, we are going to implement core feature of Twitter, posting a tweet. 

Let's dive in!

## Rendering The Wall Page

In the [previous blog post]({{< relref "creating-user-session-and-authenticating-user.md#rending-the-wall-page-with-a-placeholder" >}}), we have left the user's wall page with a placeholder. So, As a first step, let's replace this with an actual page to enable the user to post tweets. 

This initial version of user's wall page, will display a `textarea` to capture the tweet being posted and placeholder to display the list of tweets in the wall. 

It will also greet the user with a message *Hi {username}* along with links to go his/her profile page and logout. We will adding implementations for profile and logout in the later posts. 

In the *Wall.fs*, define a new type `WallViewModel` 

```fsharp
namespace Wall

module Suave =
  // ...
  open Suave.DotLiquid

  type WallViewModel = {
    Username :  string
  }
  // ...
```
and render the `user/wall.liquid` template with this view model

```diff
  let renderWall (user : User) ctx = async {
-    return! Successful.OK user.Username.Value ctx
+    let vm = {Username = user.Username.Value }
+    return! page "user/wall.liquid" vm ctx
  }
```

Create a new dotliqud template *wall.liquid* in the *views/user* directly and update it as below

```html
{% extends "master_page.liquid" %}

{% block head %}
  <title> {{model.Username}}  </title>
{% endblock %}

{% block content %}
<div>
  <div>
    <p class="username">Hi {{model.Username}}</p>
    <a href="/{{model.Username}}">My Profile</a>
    <a href="/logout">Logout</a>
  </div>
  <div>
    <div>
      <form>
        <textarea id="tweet"></textarea>     
        <button> Tweet </button>
      </form>
    </div>
  </div>
</div>
```

> Styles are ignore for brevity. 

Now, if you run the application, you will be able to see the updated wall page after login. 

![user wall v0.1](/img/fsharp/series/fstweet/wall_v0.png)

## Full Page Refresh

In the both signup and login pages, we are doing full page refresh when the user submitted the form. But in the wall page, doing a full page refresh while posting a new tweet is not a good user experience.

The better option would be having a javascript code on the wall page, doing a [AJAX](https://developer.mozilla.org/en-US/docs/AJAX/Getting_Started) POST request with a JSON payload when the user click the `Tweet` button.

That means we need to have a corresponding end point on the server responding to this request!

## Revisting The requiresAuth function

Before creating a HTTP endpoint to handle new tweet, let's have a revisit to our authentication implementation to add support for JSON HTTP endpoints.

```fsharp
let requiresAuth fSuccess =
authenticate CookieLife.Session false
  (fun _ -> Choice2Of2 redirectToLoginPage)
  (fun _ -> Choice2Of2 redirectToLoginPage)
  (userSession redirectToLoginPage fSuccess)
```

Currently, we are redirecting the user to login page, if the user didn't have access. But this approach will not work out for AJAX requests, as it doesn't full page refresh. 

What we want is a HTTP response from the server with a status code `401 Unauthorized` and a JSON body. 

To enable this, let's refactor the `requiresAuth` as below

```fsharp
// FsTweet.Web/Auth.fs
// ...
module Suave = 
  // ...
  // WebPart -> WebPart -> WebPart
  let onAuthenticate fSuccess fFailure =
    authenticate CookieLife.Session false
      (fun _ -> Choice2Of2 fFailure)
      (fun _ -> Choice2Of2 fFailure)
      (userSession fFailure fSuccess)

  let requiresAuth fSuccess =
    onAuthenticate fSuccess redirectToLoginPage
  // ...
```

We have extracted the `requiresAuth` function into a new function `onAuthenticate` and added a new parameter `fFailure` to parameterize what to do when authentication fails.

Then in the `requiresAuth` function, we are calling the `onAuthenticate` function with the `redirectToLoginPage` webpart for authentication failures. 

Now with the help of the new function `onAuthenticate`, we can send an unauthorized response in case of an authentication failure using a new function `requiresAuth2` 

```fsharp
let requiresAuth2 fSuccess =
  onAuthenticate fSuccess (RequestErrors.UNAUTHORIZED "???")
```

The `RequestErrors.UNAUTHORIZED` function, takes a `string` to populate the request body and return a `WebPart`. To send JSON string as a response body we need to do few more work!

### Sending JSON Response

To send a JSON response, there is no out of the box direct in Suave as the library doesn't want to have a dependency on any other external libaries other than [FSharp.Core](https://www.nuget.org/packages/FSharp.Core).

However, we can do it with ease with the basic HTTP abstractions provided by Suave.

We just need to serialize the return value to the JSON string representation and send the response with the header `Content-Type` populated with `application/json` value. 

To do the JSON serialization and deserialization (which we will be doing later in this blog post), let's add a [Chiron](https://xyncro.tech/chiron/) Nuget Package to the *FsTweet.Web* project.

```bash
> forge paket add Chiron -p src/FsTweet.Web/FsTweet.Web.fsproj
```

> Chiron is a JSON library for F#. It can handle all of the usual things you’d want to do with JSON, (parsing and formatting, serialization and deserialization). 

> Chiron works rather differently to most .NET JSON libraries with which you might be familiar, using neither reflection nor annotation, but instead uses a simple functional style to be very explicit about the relationship of types to JSON. This gives a lot of power and flexibility - *Chrion Documentation*


Then create a new fsharp file *Json.fs* to put all the Json related functionalities. 

```bash
> forge newFs web -n src/FsTweet.Web/Json
```

And move this file above *User.fs*

```bash
> repeat 6 forge moveUp web -n src/FsTweet.Web/Json.fs
```

To send an error message to the front-end, we are going to use the following JSON structure

```json
{
  "msg" : "..."
}
```

Let's add a function, `unauthorized`, in the *Json.fs* file that returns a WebPart having a `401 Unauthorized` response with a JSON body.

```fsharp
// FsTweet.Web/Json.fs

[<RequireQualifiedAccess>]
module JSON 

open Suave
open Suave.Operators
open Chiron

// WebPart
let unauthorized =
  ["msg", String "login required"] // (string * Json) list
  |> Map.ofList // Map<string,Json>
  |> Object // Json
  |> Json.format // string
  |> RequestErrors.UNAUTHORIZED // Webpart
  >=> Writers.addHeader 
        "Content-type" "application/json; charset=utf-8"

```

The `String` and `Object` are the union cases of the `Json` discriminated type in the Chiron library.  

The `Json.format` function creates the `string` representation of the underlying `Json` type and then we pass it to the `RequestErrors.UNAUTHORIZED` function to populate the response body with this JSON formatted string and finally we set the `Content-Type` header. 

Now we can rewrite the `requiresAuth2` function as below

```diff
let requiresAuth2 fSuccess =
-  onAuthenticate fSuccess (RequestErrors.UNAUTHORIZED "???")
+  onAuthenticate fSuccess JSON.unauthorized
```

With this we are done with the authentication side of HTTP endpoints serving JSON response. 

## Handling New Tweet POST Request

Let's add a scaffholding for handling the new Tweet HTTP POST request.

```fsharp
// FsTweet.Web/Wall.fs
module Suave = 
  // ...
  let handleNewTweet (user : User) ctx = async {
    // TODO
  }
  // ...
```

add then wire this up with a new HTTP endpoint. 

```diff
// FsTweet.Web/Wall.fs
module Suave = 
   // ...
-  let webpart () =
-    path "/wall" >=> requiresAuth renderWall 
+  let webpart () = 
+    choose [
+      path "/wall" >=> requiresAuth renderWall
+      POST >=> path "/tweets"  
+        >=> requiresAuth2 handleNewTweet  
+    ] 
```

The first step in `handleNewTweet` parsing the incoming JSON body and deserialize it to a fsharp record type. To carry out these two functionalities, `Chiron` library has two functions `Json.tryParse` and `Json.tryDeserialize`. 

Let's add a new function `parse` in *Json.fs* to parse the JSON request body in the `HttpRequest` to Chiron's `Json` type. 

```fsharp
// FsTweet.Web/Json.fs
// ...
open System.Text
open Chessie.ErrorHandling

// HttpRequest -> Result<Json,string>
let parse req = 
  req.rawForm // byte []
  |> Encoding.UTF8.GetString // string
  |> Json.tryParse // Choice<Json, string>
  |> ofChoice // Result<Json, string>
// ...
```

Then in the `handleNewTweet` function, we can call this function to parse the incoming the HTTP request.

```fsharp
let handleNewTweet (user : User) ctx = async {
  match parse ctx.request  with
  | Success json -> 
    // TODO
  | Failure err -> 
    // TODO
}
```

If there is any parser error we need to return bad request with a JSON body. To do it, let's leverage the same JSON structure that we have used for sending JSON response for unauthorized requests. 

```fsharp
// FsTweet.Web/Json.fs
// ...

// string -> WebPart
let badRequest err =
  ["msg", String err ] // (string * Json) list
  |> Map.ofList // Map<string,Json>
  |> Object // Json
  |> Json.format // string
  |> RequestErrors.BAD_REQUEST // Webpart
  >=> Writers.addHeader 
        "Content-type" "application/json; charset=utf-8"
```

The `badRequest` function and the `unauthorized` binding both has some common code. So, let's extract the common part out. 

```fsharp
// FsTweet.Web/Json.fs
// ...

let contentType = "application/json; charset=utf-8"

// (string -> WebPart) -> Json -> WebPart
let json fWebpart json = 
  json // Json
  |> Json.format // string
  |> fWebpart // WebPart
  >=> Writers.addHeader "Content-type" contentType // WebPart

// (string -> WebPart) -> string -> WebPart
let error fWebpart msg  = 
  ["msg", String msg] // (string * Json) list
  |> Map.ofList // Map<string,Json>
  |> Object // Json
  |> json fWebpart // WebPart
``` 

Then change the `unauthorized` and `badRequest` functions to use this new function

```fsharp
let badRequest msg = 
  error RequestErrors.BAD_REQUEST msg

let unauthorized = 
  error RequestErrors.UNAUTHORIZED "login required"
```

Going back to the `handleNewTweet` function, if there is any error while parsing the request JSON, we can return a bad request as response

```diff
// FsTweet.Web/Wall.fs
// ...
module Suave =
  // ...
  let handleNewTweet (user : User) ctx = async {
    match parse ctx.request  with
    | Success json -> 
      // TODO
    | Failure err -> 
-     // TODO
+     return! JSON.badRequest err ctx
  }
  // ...
```

Let's switch our focus to handle a valid JSON request from the user. 

The JSON structure of the new tweet POST request will be 

```json
{
  "post" : "Hello, World!"
}
```

To represent this JSON on the server side (like View Model), Let's create a new type `PostRequest`.

```fsharp
// FsTweet.Web/Wall.fs
module Suave = 
  // ...
  type PostRequest = PostRequest of string
  // ...
```

To deserialize the `Json` type that we get after parsing to `PostRequest`, Chiron library requires `PostRequest` type to have a static member function `FromJson` with the signature `PostRequest -> Json<PostRequest>`

```fsharp
module Suave = 
  // ...
  open Chiron

  // ...
  type PostRequest = PostRequest of string with
    // PostRequest -> Json<PostRequest>
    static member FromJson (_ : PostRequest) = json {
      let! post = Json.read "post"
      return PostRequest post 
    }
  // ...
```

We are making use of the `json` computation expression from Chrion library to create `PostRequest` from `Json`. 


Then in the `handleNewTweet` function, we can deserialize we `Json` to `PostRequest` using the `Json.tryDeserialize` function from Chiron.

```fsharp
let handleNewTweet (user : User) ctx = async {
  match parse ctx.request  with
  | Success json -> 
    match Json.tryDeserialize json with
    | Choice1Of2 (PostRequest post) -> 
      // TODO
    | Choice2Of2 err -> 
      return! JSON.badRequest err ctx
  // ...
```

The `Json.tryDeserialize` function takes `Json` as its input and return `Choice<'a, string>` where the actual type of `'a` is inferred from the usage of `Choice` and also the actual type of `'a` should have a static member function `FromJson`. 

In case of any deserialization error, we are returning it as a bad request using the `JSON.badRequest` function that we created earlier. 

Now we have the server side representation of the `PostRequest`. The next step is validating the new tweet being posted. 

Create a new file *Tweet.fs* in *FsTweet.Web* project and move it above *FsTweet.Web.fs*

```bash
> forge newFs web -n src/FsTweet.Web/Tweet
> repeat 2 forge moveUp web -n src/FsTweet.Web/Tweet.fs
```

As we did for [making illegal states unrepresentable]({{< relref "user-signup-validation.md#making-the-illegal-states-unrepresentable">}}) in user signup, let's create a new type `Post`, a domain side representation of a Tweet. 

```fsharp
// FsTweet.Web/Tweet.fs
namespace Tweet
open Chessie.ErrorHandling

type Post = private Post of string with
  // string -> Result<Post, string>
  static member TryCreate (post : string) =
    match post with
    | null | ""  -> 
      fail "Tweet should not be empty"
    | x when x.Length > 140 -> 
      fail "Tweet should not be more than 140 characters"
    | x -> 
      Post x |> ok

  
  member this.Value = 
    let (Post post) = this
    post
```

We can now use this `Post.TryCreate` static member function to validate the `PostRequest` in the `handleNewTweet` function. 

```diff
// FsTweet.Web/Wall.fs
// ...
module Suave =
  // ...
  let handleNewTweet (user : User) ctx = async {
    match parse ctx.request  with
    | Success json -> 
      match Json.tryDeserialize json with
      | Choice1Of2 (PostRequest post) -> 
-       // TODO
+       match Post.TryCreate post with
+       | Success post -> 
+         // TODO
+       | Failure err -> 
+         return! JSON.badRequest err ctx  
      // ...        
    // ...
```

With this, we are having a server side representation of valid tweet post being posted. 

The next step is persisting it!


## Persisting New Tweet

To persist a new tweet, we need a new table in our PostgreSQL database. So, let's add this in our migration file.

```fsharp
// FsTweet.Db.Migrations/FsTweet.Db.Migrations.fs

// ...

[<Migration(201710071212L, "Creating Tweet Table")>]
type CreateTweetTable()=
  inherit Migration()

  override this.Up() =
    base.Create.Table("Tweets")
      .WithColumn("Id").AsGuid().PrimaryKey()
      .WithColumn("Post").AsString(144).NotNullable()
      .WithColumn("UserId").AsInt32().ForeignKey("Users", "Id")
      .WithColumn("TweetedAt").AsDateTimeOffset().NotNullable()
    |> ignore
  
  override this.Down() = 
    base.Delete.Table("Tweets") |> ignore
```

Then run the application using `forge run` command to create the `Tweets` table using this migration. 

Upon successful execution, we will be having a `Tweets` table in our database.

```bash
> psql -d FsTweet

FsTweet=# \d "Tweets";;

              Table "public.Tweets"
  Column   |           Type           | Modifiers
-----------+--------------------------+-----------
 Id        | uuid                     | not null
 Post      | character varying(144)   | not null
 UserId    | integer                  | not null
 TweetedAt | timestamp with time zone | not null
Indexes:
    "PK_Tweets" PRIMARY KEY, btree ("Id")
Foreign-key constraints:
    "FK_Tweets_UserId_Users_Id" 
      FOREIGN KEY ("UserId") REFERENCES "Users"("Id")
```

Then define a new type for representing the function persisting a new tweet.

```fsharp
// FsTweet.Web/Tweet.fs

// ...
open User
open System
// ...

type PostId = PostId of Guid

type CreatePost = 
  UserId -> Post -> AsyncResult<PostId, Exception>
``` 

Then create a new module `Persistence` in *Tweet.fs* and define the `createPost` function which provides the implementation of the peristing a new tweet in PostgreSQL using SQLProvider. 

```fsharp
// FsTweet.Web/Tweet.fs
// ...
module Persistence =

  open User
  open Database
  open System

  let createPost (getDataCtx : GetDataContext) 
        (UserId userId) (post : Post) = asyncTrial {

    let ctx = getDataCtx()
    let newTweet = ctx.Public.Tweets.Create()
    let newPostId = Guid.NewGuid()

    newTweet.UserId <- userId
    newTweet.Id <- newPostId
    newTweet.Post <- post.Value
    newTweet.TweetedAt <- DateTime.UtcNow

    do! submitUpdates ctx 
    return PostId newPostId
  }
```

To wire this up with peristence logic with the `handleNewTweet` function, we need to transform the `AsyncResult<PostId, Exception>` to `WebPart`. 

Before we go ahead and implement it, let's add few helper functions in *Json.fs* to send `Ok` and `InternalServerError` responses with JSON body

```fsharp
// FsTweet.Web/Json.fs
// ...

// WebPart 
let internalError =
  error ServerErrors.INTERNAL_ERROR "something went wrong"

// Json -> WebPart
let ok =
  json (Successful.OK)
```

Then define what we need to for both `Success` and `Failure` case. 

```fsharp
// FsTweet.Web/Wall.fs
// ... 
module Suave = 
  // ...
  open Chessie.ErrorHandling
  open Chessie

  // ...

  // PostId -> WebPart
  let onCreateTweetSuccess (PostId id) = 
    ["id", String (id.ToString())] // (string * Json) list
    |> Map.ofList // Map<string, Json>
    |> Object // Json
    |> JSON.ok // WebPart

  // Exception -> WebPart
  let onCreateTweetFailure (ex : System.Exception) =
    printfn "%A" ex
    JSON.internalError

  // Result<PostId, Exception> -> WebPart
  let handleCreateTweetResult result = 
    either onCreateTweetSuccess onCreateTweetFailure result 

  // AsyncResult<PostId, Exception> -> Async<WebPart>
  let handleAsyncCreateTweetResult aResult =
    aResult // AsyncResult<PostId, Exception>
    |> Async.ofAsyncResult // Async<Result<PostId, Exception>>
    |> Async.map handleCreateTweetResult // Async<WebPart>

  // ...
```

The final piece is passing the dependency `getDataCtx` for the `createPost` function from the application's main function. 

```diff
// FsTweet.Web/Auth.fs
// ...
-      Wall.Suave.webpart ()
+      Wall.Suave.webpart getDataCtx
    ]
```

```diff
// FsTweet.Web/Wall.fs
// ...
-  let handleNewTweet (user : User) ctx = async {
+  let handleNewTweet createTweet (user : User) ctx = async {
// ...

-  let webpart () = 
+  let webpart getDataCtx =
+    let createTweet = Persistence.createPost getDataCtx 
     choose [
       path "/wall" >=> requiresAuth renderWall
       POST >=> path "/tweets"  
-        >=> requiresAuth2 handleNewTweet
+        >=> requiresAuth2 (handleNewTweet createTweet)  
    ]
```

And then invoke the `createPost` function in the `handleNewTweet` function and transform the result to `WebPart` using the `handleAsyncCreateTweetResult` function. 

```diff
+  let handleNewTweet createTweet (user : User) ctx = async {
      // ...
        match Post.TryCreate post with
        | Success post -> 
-         // TODO
+         let aCreateTweetResult = 
+           createTweet user.UserId post
+         let! webpart = 
+           handleAsyncCreateTweetResult aCreateTweetResult
+         return! webpart ctx
      // ...
    }
```

With this we have successfully added support for creating a new tweet.

To invoke this HTTP API from the front end, let's create a new javascript file *FsTweet.Web/assets/js/wall.js* and update it as below 

```js
$(function(){
  $("#tweetForm").submit(function(event){
    event.preventDefault();

    $.ajax({
      url : "/tweets",
      type: "post",
      data: JSON.stringify({post : $("#tweet").val()}),
      contentType: "application/json"
    }).done(function(){
      alert("successfully posted")
    }).fail(function(jqXHR, textStatus, errorThrown) {
      console.log({
        jqXHR : jqXHR, 
        textStatus : textStatus, 
        errorThrown: errorThrown})
      alert("something went wrong!")
    });

  });
});
```

Then in the *wall.liquid* template include this script file.

```html
<!-- FsTweet.Web/views/user/wall.liquid -->
// ...
{% block scripts %}
<script src="/assets/js/wall.js"></script>
{% endblock %}
```

> We are making use of the `scripts block` defined the *master_page.liquid* here. 
```html
<div id="scripts">
  <!-- ... -->
  {% block scripts %}
  {% endblock %}
</div>	
```

Let's run the application and do a test drive to verify this new feature.

![First Tweet Post](/img/fsharp/series/fstweet/first_tweet_post.png)

We can also verify it in the database

![First Tweet Query](/img/fsharp/series/fstweet/first_tweet_query.png)

Awesome! We made it!!

## Revisiting AsyncResult to WebPart Transformation

In all the places to transform `AsyncResult` to `WebPart` we were using the following functions

```fsharp
// FsTweet.Web/Wall.fs

// Result<PostId, Exception> -> WebPart
let handleCreateTweetResult result = ...

// AsyncResult<PostId, Exception> -> Async<WebPart>
let handleAsyncCreateTweetResult aResult = ...

// FsTweet.Web/Auth.fs

// LoginViewModel -> Result<User,LoginError> -> WebPart
let handleLoginResult viewModel loginResult = 

// LoginViewModel -> AsyncResult<User,LoginError> -> Async<WebPart>
let handleLoginAsyncResult viewModel aLoginResult = 

// FsTweet.Web/UserSignup.fs
// ...
```

We can generialize this transformation as 

```fsharp
   ('a -> 'b) -> ('c -> 'b) -> AsyncResult<'a, 'c> -> Async<'b>
//  onSuccess     onFailure      aResult              aWebPart
```

It is similar to the signature of the `either` function in the Chessie library

```fsharp
('a -> 'b) -> ('c -> 'b) -> Result<'a, 'c> -> 'b
```

The only difference is the function that we need should work with `AsyncResult` instead of `Result`. In other words, we need an `either` function for `AsyncResult`.

Let's create this out
```fsharp
// FsTweet.Web/Chessie.fs
// ...

module AR = 
  // ...
  let either onSuccess onFailure aResult = 
    aResult
    |> Async.ofAsyncResult
    |> Async.map (either onSuccess onFailure)
```

With this we can refactor the *Wall.fs* as below

```diff
// FsTweet.Web/Wall.fs
// ...

-  let handleCreateTweetResult result = 
-    either onCreateTweetSuccess onCreateTweetFailure result 
-
-  let handleAsyncCreateTweetResult aResult =
-    aResult
-    |> Async.ofAsyncResult
-    |> Async.map handleCreateTweetResult

// ...
   let handleNewTweet createTweet (user : User) ctx = async {
      // ...
        match Post.TryCreate post with
        | Success post -> 
-        let aCreateTweetResult = createTweet user.UserId post
          let! webpart = 
-          handleAsyncCreateTweetResult aCreateTweetResult
+          createTweet user.UserId post
+          |> AR.either onCreateTweetSuccess onCreateTweetFailure
        // ...
```

Now it looks cleaner, Isn't it? 

> Making this similar refactoring in *UserSignup.fs* and *Auth.fs* as well

## Unifying JSON parse and deserialize

In the `handleNewTweet` function, we are doing two things to get the server side representation of the tweet being posted, parsing and deserializing.

If there is any error while doing any of these, we are returning bad request as response.

```fsharp
let handleNewTweet ... = async {
  // ...
  match parse ctx.request  with
  | Success json -> 
      match Json.tryDeserialize json with
      | Choice1Of2 (PostRequest post) ->
      // ...
      | Choice2Of2 err ->
      // ...
  // ...
```

We can unify these two functions together that has the following signature

```fsharp
HttpRequest -> Result<^a, string>
```

> Note: We are using `^a` instead of `'a`. i.e., `^a` is a [Statically resolved type parameter](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/generics/statically-resolved-type-parameters). We need this as we `Json.tryDeserialize` requires the `FromJson` static member function constraint.

Let' name this function `deserialize` and the implemenation in *Json.fs*

```fsharp
// FsTweet.Web/Json.fs
// ...

// HttpRequest -> Result<^a, string>
let inline deserialize< ^a when (^a or FromJsonDefaults) 
                          : (static member FromJson: ^a -> ^a Json)> 
                          req : Result< ^a, string> =

  parse req // Result<Json, string>
  |> bind (fun json -> 
            json 
            |> Json.tryDeserialize 
            |> ofChoice) // Result<^a, string>

// ...
```

Chiron library has `FromJsonDefaults` type to extend the fsharp primitive types to have the `FromJson` static member function. The `bind` function is from Chessie library, which maps the success part of the `Result` with the provided function. 

With this new function, we can rewrite the `handleNewTweet` function as below

```diff
   let handleNewTweet ctx = async {
-    match parse ctx.request  with
-    | Success json -> 
-       match Json.tryDeserialize json with
-       | Choice1Of2 (PostRequest post) -> 
+    match deserialize ctx.request  with
+    | Success (PostRequest post) -> 
   // ...
```

## Summary

In this blog post, we saw how to expose JSON HTTP endpoints in Suave and also learned how to use the Chiron libary to deal with JSON.

The source code associated with this blog post is available on [GitHub]()
