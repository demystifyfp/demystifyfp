---
title: "Reorganising Code and Refactoring"
date: 2017-09-21T04:55:36+05:30
tags: [fsharp, refactoring, Chessie]
---

Hi there!

Welcome to the twelth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series. 

We have came a long way so far and we have lot more things to do! 

Before we get going, Let's spend some time to reorganise some of the code that we wrote and refactor certain functions to help ourselves to move faster.

The *UserSignup.fs* file has some helper functions for working with the Chessie library. As a first step, we will move them to a separate file.
 
Let's create a new file `Chessie.fs` in the `web` project. 

```bash
> forge newFs web -n src/FsTweet.Web/Chessie
```

Then move it above `Db.fs`. In other words move it up four times. 

```bash
> repeat 4 forge moveUp web -n src/FsTweet.Web/Chessie.fs
```

> We are using the in-built command, `repeat`, from [omyzsh](http://ohmyz.sh/) to repeat the `forge moveUp` four times. 

## Moving mapFailure Function

In the [previous blog post]({{ relref "verifying-user-email.md" }}), while implementing the static member function `TryCreateAsync` in the `Username` type, we moved the `mapFailure` from its previous place to above the `Username` type to use it in the `TryCreateAsync` function.

It is a cue for us to reconsider the placement of the `mapFailure` function, as we may need to move it to somewhere else if we want to use it in an another function.

So, let's move this function to the `Chessie.fs` file that we just created. 

```fsharp
// FsTweet.Web/Chessie.fs
module Chessie

open Chessie.ErrorHandling

let mapFailure f result = 
  let mapFirstItem xs = 
    List.head xs |> f |> List.singleton 
  mapFailure mapFirstItem result
```

After we move this function to here, we need to refer this `Chessie` module in the `Domain` module.

```fsharp
// FsTweet.Web/UserSignup.fs
namespace UserSignup

module Domain =
  // ...
  open Chessie
```

## Overriding The either function

We are making use of the `either` function from the chessie library to map the `Result` to `WebPart` with some compromises on the design.

To fix this, let's have a look at the signature of the `either` function

```fsharp
('b -> 'c) -> ('d -> 'c) -> (Result<'b, 'd> -> 'c)
``` 

It takes a function to map the success part `('b -> 'c)` and an another function to map the failure part `('d -> 'c)` and returns a function that takes a `Result<'b, 'd>` type and returns `'c`. 

It is the same thing that we needed but the problem is the actual type of `'b` and `'d` 

The success part `'b` has a type `('TSuccess, 'TMessage list)` to represent both the success and the warning part. As we are not making use of warning in FsTweet, instead of this tuple and we just need the success part `'TSuccess` alone. 

To achieve it let's add a `onSuccess` adapter function which maps only the success type

```fsharp
// FsTweet.Web/Chessie.fs
module Chessie
// ...

// ('a -> 'b) -> ('a * 'c) -> 'b
let onSuccess f (x, _) = f x
```

Then move our attention to the failure part `d` which has a type `'TMessage list` representing the list of errors. In FsTweet, we are short circuiting as soon as we found the first error and we are not capturing all the errors. So, in our case the type `'TMessage list` will always have a list with only one item `'TMessage`.

Like `onSuccess`, we can have a function `onFailure` to map the first item of the list.

```fsharp
module Chessie
// ...

// ('a -> 'b) -> ('a  list) -> 'b
let onFailure f xs = 
  xs |> List.head |> f
```

The `onFailure` takes the first item from the list and uses it as the argument while calling the map function `f`.

Now with the help of these two functions, `onSuccess` and `onFailure`, we can override the `either` function.


```fsharp
module Chessie
// ...

// ('b -> 'c) -> ('d -> 'c) -> (Result<'b, 'd> -> 'c)
let either onSuccessF onFailureF = 
  either (onSuccess onSuccessF) (onFailure onFailureF)
```

The overrided version `either` has the same signature but treats the success part without warnings and the failure part as a single item instead of a list.


Let's use this in the `Suave` module in the functions that transform `Result<Username option, Exception list>` to `WebPart`.

```diff
// FsTweet.Web/UserSignup.fs
namespace UserSignup
// ...
module Sauve =
  // ...
  open Chessie
  // ...

- let onVerificationSuccess (username, _ ) = 
+ let onVerificationSuccess username = 
    // ...

- let onVerificationFailure errs =
-   let ex : System.Exception = List.head errs
+ let onVerificationFailure (ex : System.Exception) =
    // ...

  // ...
```

Thanks to the adapter functions, `onSuccess` and `onFailure`, now the function signatures are clearly expressing our intent without an compromises. 

Let's do the same thing for the functions that map `Result<UserId, UserSignupError>` to `WebPart`

```diff
module Suave = 
  // ...

- let handleUserSignupError viewModel errs = 
-   match List.head errs with
+ let onUserSignupFailure viewModel err = 
+   match err with
    // ...

- let handleUserSignupSuccess viewModel _ =
+ let onUserSignupSuccess viewModel _ =
    // ...

  let handleUserSignupResult viewModel result =
    
-  either 
-   (handleUserSignupSuccess viewModel)
-   (handleUserSignupError viewModel) result
+    either 
+     (onUserSignupSuccess viewModel)
+     (onUserSignupFailure viewModel) result

  // ...
```

> While changing the function signature, we have also changed the prefix `handle` to `on` to keep it consitent with the nomanclature that we are using to the functions that are mapping the success and failure parts of a `Result` type.  


## Revisting the mapAsyncFailure function

Let's begin this change by looking at the signature of the `mapAsyncFailure` function

```fsharp
('a -> 'b) -> AsyncResult<'c, 'a> -> AsyncResult<'c, 'b>
```

It maps the failure part `'a` to `'b` with the help of the mapping function `('a -> 'b)` of an `AsyncResult`. But the name `mapAsyncFailure` not clearly communicates this. 

The better name would be `mapAsyncResultFailure`. 

An another option would be having the function `mapFailure` in the module `AsyncResult` so that the caller will use it as `AsyncResult.mapFailure` 

We can also use an abbreviation `AR` to represent `AsyncResult` and we can call the function as `AR.mapFailure` 

Let's choose `AR.mapFailure` as it is shorter. 

To enable this, we need to create a new module `AR` and decorate it with the [RequireQualifiedAccess](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/core.requirequalifiedaccessattribute-class-%5Bfsharp%5D) Attribute so that functions inside this module can't be called without the module name. 

```fsharp
// FsTweet.Web/Chessie.fs
module Chessie
// ...

[<RequireQualifiedAccess>]
module AR =
  // TODO
```

Then move the `mapAsyncFailure` function to this module and rename it to `mapFailure` 

```fsharp
module AR =
  let mapFailure f aResult =
    aResult
    |> Async.ofAsyncResult 
    |> Async.map (mapFailure f) |> AR
```

And finally we need to use this moved and renamed function in the `Persistence` and `Email` modules in the *UserSignup.fs* file. 

```diff
// FsTweet.Web/UserSignup.fs
// ...
module Persistence =
  // ...
  open Chessie
  // ...

  let createUser ... = 
    // ...
-   |> mapAsyncFailure mapException
+   |> AR.mapFailure mapException

  // ...
```

```diff
// FsTweet.Web/UserSignup.fs
// ...
module Email = 
  // ...
  open Chessie
  // ...

  let sendSignupEmail ... =
    // ...
-   |> mapAsyncFailure Domain.SendEmailError
+   |> AR.mapFailure Domain.SendEmailError
```

## Defining AR.catch function

Let's switch our focus to the `Database` module and give some attention the following piece of code.

```fsharp
// FsTweet.Web/Db.fs
// ...
let submitUpdates ... = 
  // ...
  |> Async.Catch
  |> Async.map ofChoice
  |> AR

let toAsyncResult ... =
  // ...
  |> Async.Catch
  |> Async.map ofChoice
  |> AR 
```

The three lines of code that were repeated, takes an asynchronous computation `Async<'a>` and exceutes it with exception handling using `Async.Catch` function and then map the `Async<Choice<'a, Exception>>` to `AsyncResult<'a, Exception>`. 

In other words we can extract these three lines to a separate function which has the signature

```fsharp
Async<'a> -> AsyncResult<'a, Exception>
```

Let's create this function in the `AR` module

```fsharp
// FsTweet.Web/Chessie.fs
// ...
module AR =
  // ...

  let catch aComputation =
    aComputation // Async<'a>
    |> Async.Catch // Async<Choice<'a, Exception>>
    |> Async.map ofChoice // Async<Result<'a, Exception>>
    |> AR // AsyncResult<'a, Exception>
```

Then use it in the `submitUpdates` function and remove the `toAsyncResult` function in the `Database` module

```fsharp
// FsTweet.Web/Db.fs
// ...
open Chessie
// ...

let submitUpdates ... = 
  // ...
  |> AR.catch
```

Finally change the `verifyUser` function to use this function instead of the removed function `toAsyncResult`

```diff
// FsTweet.Web/UserSignup.fs
// ...
module Persistence =
  // ...
  open Chessie
  // ...

  let verifyUser ... = 
    // ...
-   } |> Seq.tryHeadAsync |> toAsyncResult
+   } |> Seq.tryHeadAsync |> AR.catch
    // ...

  // ...
```

With these we are done with the refactoring and reorganising of the functions associated with the Chessie library.

## The User Module

The `Domain` module in the *UserSignup.fs* file has the following types that represents the individual properties of an user in FsTweet

```fsharp
Username
UserId
EmailAddress
Password
PasswordHash 
```

So, let's put these types in a separate module `User` and use it in the `Domain` module of `UserSignup`

Create a new file, *User.fs*, in the web project and move it above `Db.fs` file

```bash
> forge newFs web -n src/FsTweet.Web/User
> repeat 4 forge moveUp web -n src/FsTweet.Web/User.fs
```

Then move the types that we just listed

```fsharp
// FsTweet.Web/User.fs
module User 

type Username = ...
type UserId = ...
type EmailAddress = ...
type Password = ...
type PasswordHash = ...
```

Finally use this module in the *UserSignup.fs* file

```fsharp
// FsTweet.Web/UserSignup.fs
namespace UserSignup

module Domain =
  // ...
  open User
  // ...
module Persistence =
  // ...
  open User
  // ...
// ...
module Suave =
  // ...
  open User
  // ...
```

## Summary

In this blog post, we learned how to create adapter funtions and override a functionality provided by a library to fit our custom requirements. The key to this refactoring is understanding of the function signatures.

The source code associated with this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.11)