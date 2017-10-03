---
title: "Creating User Session and Authenticating User"
date: 2017-10-02T13:48:35+05:30
draft: true
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
    
  // User -> WebPart
  let createUserSession (user : User) =
    statefulForSession 
    >=> context (setState userSessionKey user)

  // ...
```

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
