---
title: "Creating User Session and Authenticating User"
date: 2017-10-02T13:48:35+05:30
tags: [suave, authentication, fsharp]
---

Hi!

Welcome back to the fifteenth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series. 

In the [previous blog post]({{< relref "handling-login-request.md" >}}), we have implemented the backend logic to verify the login credentials of a user. Upon successful verification of the provided credentials, we just responded with a username. 

```fsharp
// FsTweet.Web/Auth.fs
// ...
module Suave =
  // ...
  open User
  // ...
  // User -> WebPart
  let onLoginSuccess (user : User) = 
    Successful.OK user.Username.Value
  // ...
```

In this blog post, we are going to replace this placeholder with the actual implementation. 


## Creating Session Cookie 

As HTTP is [a stateless protocol](https://stackoverflow.com/questions/13200152/why-say-that-http-is-a-stateless-protocol), we need to create a unique session id for every successful login verification and a [HTTP cookie](https://en.wikipedia.org/wiki/HTTP_cookie) to holds this session id. 

This session cookie, will be present in all the subsequent requests from the user and we can use it to authenticate the user instead of prompting the username and the password for each requests. 

To create this session id and the cookie, we are going to leverage the [authenticated](https://suave.io/Suave.html#def:val Suave.Authentication.authenticated) function from Suave.

It takes two parameters and return a `Webpart` 

```fsharp
CookieLife -> bool -> Webpart
```

The `CookieLife` defines the lifespan of a cookie in the user's browser and the `bool` parameter is to specify the presence of the cookie in `HTTPS` alone. 

```diff
module Suave = 
+ open Suave.Authentication
+ open Suave.Cookie
  // ...

  let onLoginSuccess (user : User) = 
-   Successful.OK user.Username.Value
+   authenticated CookieLife.Session false

  // ...
```

The `CookieLife.Session` defines that the cookie will be present til the user he quits the browser. There is an another option `MaxAge of TimeSpan` to define the lifespan of cookie using TimeSpan. And as we are not using HTTPS, we need to set the second parameter as `false`. 

The session id in the cookie doesn't personally identify the user. So, we need to store the associated user information in some other place. 

```bash
+------------------+--------------------+
|     SessionId    |       UserId       |
|                  |                    |
+---------------------------------------+
|                  |                    |
|                  |                    |
+------------------+--------------------+
```

There are multiple ways we can achieve it.

1. Adding a new table in the database and persist the relationship. 

2. We can even use a NoSQL datastore to store this key-value data

3. We can store it an in-memory cache in the server. 

4. We can make use of an another HTTP cookie. 

Every approach has its own pros and cons and we need to pick the opt one. 
 
Suave library has an absraction to deal with this state management.

> https://github.com/SuaveIO/suave/blob/master/src/Suave/State.fs
```fsharp
type StateStore =
  /// Get an item from the state store
  abstract get<'T> : string -> 'T option
  /// Set an item in the state store
  abstract set<'T> : string -> 'T -> WebPart
```

It also provides two out of the box implementations of this abstraction, `MemoryCacheStateStore` and `CookieStateStore` that corresponds to the third and fourth ways defined above respectively. 

In our case, We are going to use `CookieStateStore`. 

```fsharp
// FsTweet.Web/Auth.fs
// ...
module Suave =
  // ...
  open Suave.State.CookieStateStore

  // ...
  // string -> 'a -> HttpContext -> WebPart
  let setState key value ctx =
    match HttpContext.state ctx with
    | Some state ->
       state.set key value
    | _ -> never
    
  let userSessionKey = "fsTweetUser"

  // User -> WebPart
  let createUserSession (user : User) =
    statefulForSession 
    >=> context (setState userSessionKey user)

  // ...
```

The `statefulForSession` function, a WebPart from Suave, intializes the `state` in the `HttpContext` with `CookieStateStore`. 

The `setState` function takes a key and a value, along with a `HttpContext`. If there is a state store present in the `HttpContext`, it stores the key and the value pair. In the absense of a state store it does nothing and we are making the `never` WebPart from Suave to denote it. 

An important thing that we need to notice here is `setState` function doesn't know what is the underlying `StateStore` that we are using. 

In the `createUserSession` function, we are initializing the `StateStore` to use `CookieStateStore` by calling the `statefulForSession` function and then calling the `setState` to store the user information in the state cookie. 

We are making use of the `context` function (aka combinator) while calling the `setState`. The `context` function from the Suave library which is having the following signature

```fsharp
(HttpContext -> WebPart) -> WebPart
``` 

The final step in calling this `createUserSession` function from the `onLoginSuccess` function and redirects the user to his/her home page. 

```fsharp
let onLoginSuccess (user : User) = 
  authenticated CookieLife.Session false 
    >=> createUserSession user
    >=> Redirection.FOUND "/wall"
``` 

## Rending The Wall Page With A Placeholder 

In the previous section, upon successful login, we are redirecting to the wall page (`/wall`). This is currently not exist. So, let's add it with a placeholder and we will revisit in an another blog post. 

Let's get started by creating a new fsharp file *Wall.fs* and move it above *FsTweet.Web.fs*

```bash
> forge newFs web -n src/FsTweet.Web/Wall
> forge moveUp web -n src/FsTweet.Web/Wall.fs
```

Then in the *Wall.fs* file add this initial implementation of User's wall.

```fsharp
// FsTweet.Web/Wall.fs
namespace Wall

module Suave =
  open Suave
  open Suave.Filters
  open Suave.Operators

  let renderWall ctx = async {
    return! Successful.OK "TODO" ctx
  }
  
  let webpart () =
    path "/wall" >=> renderWall
```

And finally call this `webpart` function from the `main` function

```fsharp
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  // ...
  let app = 
    choose [
      // ...
      Wall.Suave.webpart ()
    ]
  // ...
```

Now if we run the application and login using a registered account, we will be redirected to the wall page and we can find the cookies for `auth` and `state` in the browser.

![Wall Page With Cookies](/img/fsharp/series/fstweet/wall-page-with-cookies.png)

The values of these cookies are encrypted using a randomly generated key in the server side by Suave. We can either provide this key or let the suave to generate one. 

The downside of letting suave to generate the key is, it will generate a new key whenever the server restarts. And also if we run multiple instances of `FsTweet.Web` behind a load balancer, each instance will have its own server key. 

So, the ideal thing would be explicitly providing the server key.

As mentioned in the *Server Keys* section of the [official documentation](https://suave.io/sessions.html), To generate a key let's create a script file *script.fsx* and add the provided code snippet to generate the key.

```fsharp
// script.fsx
#r "./packages/Suave/lib/net40/Suave.dll"

open Suave.Utils
open System

Crypto.generateKey Crypto.KeyLength
|> Convert.ToBase64String
|> printfn "%s"
```

When we run this script, it will be print a key. 

The next step is passing this a key as an environment variable to the application and configuring the suave web server to use this key

```diff
// FsTweet.Web/FsTweet.Web.fs

let main argv = 
  // ...
+  let serverKey = 
+    Environment.GetEnvironmentVariable "FSTWEET_SERVER_KEY"
+    |> ServerKey.fromBase64
+  let serverConfig = 
+    {defaultConfig with serverKey = serverKey}

+  startWebServer serverConfig app
-  startWebServer defaultConfig app
```

## Protecting WebParts

Currently, the Wall page can be accessed even with out login as we are not protecting it. 

To protect it, we need to do the following things

1. Validate the Auth Token present in the cookie
2. Deserialize the `User` type from the user state cookie.
3. Call a WebPart with the deserialized user type only if step one and two are successful
4. Redirect user to the login page if either step one or two failed. 

For validating the auth token present in the cookie, `Suave.Authentication` module has a function called `authenticate`. 

This `authenticate` function takes five parameters

1. *relativeExpiry* (`CookieLife`) - How long does the authentication cookie last?

2. *secure* (`bool`) - HttpsOnly?

3. *missingCookie* (`unit -> Choice<byte[],WebPart>`) - What to do if authentication cookie is missing?

4. *decryptionFailure* (`SecretBoxDecryptionError -> Choice<byte[],WebPart>`) - What to do if there is any error while decrypting the value present in the cookie?

5. *fSuccess* (`WebPart`) - What to do upon successful verification of authentication cookie?

Let's put this `authenticate` function in action

```fsharp
// FsTweet.Web/Auth.fs
module Suave = 
  // ...
  let redirectToLoginPage =
    Redirection.FOUND "/login"

  let requiresAuth fSuccess =
    authenticate CookieLife.Session false
      (fun _ -> Choice2Of2 redirectToLoginPage)
      (fun _ -> Choice2Of2 redirectToLoginPage)
      ??? // TODO
  // ...
```

For both `missingCookie` and `decryptionFailure`, we are redirecting the user to the login page and for a valid a auth session cookie, we need to give some thoughts. 

We need to retrieve the `User` value that we persisted in the cookie upon successful login and then we have to call the provided `fSuccess`. If there is any error while retrieving the user from cookie, we need to redirect to the login page. 

```fsharp
module Suave = 
  // ...

  // HttpContext -> User option
  let retrieveUser ctx : User option =
      match HttpContext.state ctx with
      | Some state -> 
        state.get userSessionKey
      | _ -> None

  // WebPart -> (User -> WebPart) -> HttpContext -> WebPart
  let initUserSession fFailure fSuccess ctx =
    match retrieveUser ctx with
    | Some user -> fSuccess user
    | _ -> fFailure

  // WebPart -> (User -> WebPart) -> WebPart
  let userSession fFailure fSuccess = 
    statefulForSession 
    >=> context (initUserSession fFailure fSuccess)

  // ...

  // (User -> WebPart) -> WebPart
  let requiresAuth fSuccess =
    authenticate ...
      ...
      (userSession redirectToLoginPage fSuccess)

  // ...
``` 

In the `userSession` function, we are initializing the user state from the `CookieStateStore` by calling the `statefulForSession` function and then we retrive the logged in user from the state cookie. 

With the help of the `requiresAuth` function, now we can define a WebPart that can be accessed only by the authenticated user. 

Going back to `renderWall` function that we created in *Wall.fs*, we can now make it accesible only for the authenticated user by doing the following changes. 

```diff
// FsTweet.Web/Wall.fs
module Suave =
  // ...
+ open User
+ open Auth.Suave

- let renderWall ctx = async {
+ let renderWall (user : User) ctx = async {
-   return! Successful.OK "TODO" ctx
+   return! Successful.OK user.Username.Value ctx
+ }

  let webpart () =
-   path "/wall" >=> renderWall
+   path "/wall" >=> requiresAuth renderWall
```

Instead of displaying a plain text, `TODO`, we have replaced it with the username of the loggedin user. We will be revisiting this `renderWall` function in the later blog posts. 

## Handling Optional Authentication

Say if the user is already logged in and if he/she visits `/login` page, right now we are rendering the login page and prompting the user to login again. 

But better user experience would be redirecting the user to the wall page. 

To acheive it, let's create new function `mayRequiresAuth`. 

```fsharp
// FsTweet.Web/Auth.fs
module Suave = 
  // ...

  // (User option -> WebPart) -> WebPart
  let optionalUserSession fSuccess =
    statefulForSession
    >=> context (fun ctx -> fSuccess (retrieveUser ctx))

  // (User option -> WebPart) -> WebPart
  let mayRequiresAuth fSuccess =
    authenticate CookieLife.Session false
      (fun _ -> Choice2Of2 (fSuccess None))
      (fun _ -> Choice2Of2 (fSuccess None))
      (optionalUserSession fSuccess)

  // ...
```

The `mayRequiresAuth` function is similar to `requiresAuth` except that it calls the `fSuccess` function with a `User option` type instead of redirecting to login page if the user didn't login. 

The next step is changing the `renderLoginPage` function to accomodate this new requirement.

```diff
// FsTweet.Web/Auth.fs

module Suave =
  // ...
-  let renderLoginPage (viewModel : LoginViewModel) = 
-    page loginTemplatePath viewModel
+  let renderLoginPage (viewModel : LoginViewModel) hasUserLoggedIn = 
+    match hasUserLoggedIn with
+    | Some _ -> Redirection.FOUND "/wall"
+    | _ -> page loginTemplatePath viewModel

  // ...

   let webpart getDataCtx =
      let findUser = Persistence.findUser getDataCtx
      path "/login" >=> choose [
-       GET >=> renderLoginPage emptyLoginViewModel
+       GET >=> mayRequiresAuth (renderLoginPage emptyLoginViewModel)
        POST >=> handleUserLogin findUser
      ]
```

As we have changed the `renderLoginPage` function to take an extra parameter `hasUserLoggedIn`, we need to add a `None` as the last argument wherever we are calling the  `renderLoginPage` function. 

```diff
...
- renderLoginPage vm
+ renderLoginPage vm None
...

- return! renderLoginPage viewModel ctx
+ return! renderLoginPage viewModel None ctx
```

## Summary

In this blog post, we learned how to do authentication in Suave and manage state using cookies. The source code associated with this part is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.14)
