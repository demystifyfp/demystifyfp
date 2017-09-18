---
title: "Verifying User Email"
date: 2017-09-17T13:27:49+05:30
draft: true
---

Hi,

In the previous blog post, we added support for [sending verification email]({{< relref "sending-verification-email.md" >}}) using [Postmark](https://postmarkapp.com/). 

In this blog post, we are going to wrap up the user signup workflow by implementing the backend logic of the user verifcation link in the email. 


## A Type For The Verify User Function.

Let's get started by defining a type for the function which verifies the user. 

```fsharp
type VerifyUser = string -> AsyncResult<Username option, System.Exception>
``` 

It takes a verifcation code of type `string` and asynchronously returns either `Username option` or an exception if there are any fatal errors while verifying the user. 

The `Username option` type will have the value if the verification code matches otherwise it would be `None`. 

## Implementing the Verify User Function

The implementation of the `VerifyUser` function will take two parameters

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Persistence = 
  // ...
  let verifyUser 
    (getDataCtx : GetDataContext) 
    (verificationCode : string) = asyncTrial {
    // TODO
  } 
```

The first parameter `getDataCtx` represents the factory function to get the SQLProvider's datacontext that [we implemented]({{< relref "persisting-new-user.md#datacontext-one-per-request" >}}) while persisting a new user. Upon partially applying this parameter alone will return a function of type `VerifyUser`

As a first step, we need to query the users table to get the user associated with the verification code provided. 

```fsharp
let verifyUser 
    (getDataCtx : GetDataContext) 
    (verificationCode : string) = asyncTrial {
    
    let ctx = getDataCtx ()
    let userToVerify = 
      query {
        for u in ctx.Public.Users do
        where (u.EmailVerificationCode = verificationCode)
      } // 
    // TODO
  } 
```

SQLProvider uses the [F# Query Expressions](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/query-expressions) to query a data source. 

The query expression that we wrote here is returning a value of type `IQueryable<DataContext.public.UsersEntity>`. 

To get the first item from this `IQueryable` asynchronously, we need to call `Seq.tryHeadAsync` function (an extension function provided by the SQLProvider)

```fsharp
let verifyUser ... = asyncTrial {
    // ...
    let userToVerify = 
      query {
        // ...
      } |> Seq.tryHeadAsync
    // TODO
  } 
```

Now `userToVerify` will be of type `Async<DataContext.public.UsersEntity option>`. 

Like `SubmitUpdatesAsync` function, the `tryHeadAsync` throws exceptions if there is any error during the execution of the query. So, we need to catch the exception and return it as an `AsyncResult`.

Let's add a new function in the `Database` module to do this

```fsharp
// src/FsTweet.Web/Db.fs
// ...
let toAsyncResult queryable =
  queryable // Async<'a>
  |> Async.Catch // Async<Choice<'a, Exception>>
  |> Async.map ofChoice // Async<Result<'a, Exception>>
  |> AR // AsyncResult<'a, Exception>
```

This implementation to very similar to what we did in the implementaion of the [submitUpdates]({{< relref "persisting-new-user.md#async-exception-to-async-result" >}})


Now, with the help of this `toAsyncResult` function, we can now do the exception handling in the `verifyUser` function.

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Persistence = 
  // ...
  let verifyUser ... = asyncTrial {
    let! userToVerify = 
      query {
        // ...
      } |> Seq.tryHeadAsync |> toAsyncResult
    // TODO
  } 
```

Note that, We have changed `let` to `let!` to retrieve the `UsersEntity option` from `AsyncResult<DataContext.public.UsersEntity option>`. 

Great!

If the `userToVerify` didn't exist, we just need to return `None`

```fsharp
let verifyUser ... = asyncTrial {
  let! userToVerify = // ...
  match userToVerify with
  | None -> return None
  | Some user ->
    // TODO
} 
```

If the user exists, then we need to set the verification code to empty (to prevent from using it multiple times) and mark the user as verified and persist the changes.

```fsharp
let verifyUser ... = asyncTrial {
  // ...
  | Some user ->
    user.EmailVerificationCode <- ""
    user.IsEmailVerified <- true
    do! submitUpdates ctx
    // TODO
}
```

The last step is returning the username of the User to let the caller of the `verifyUser` function to know that the user has been verified and greet the user with the username. 

We already have a domain type `Username` to represent the username. But the type of the username that we retrieved from the database is `string`. 

So, We need to convert it from `string` to `Username`. To do it we defined a static function on the `Username` type, `TryCreate`, which takes a `string` and returns `Result<Username, string>`. 

We could use this function here but let's ponder over the scenario. 

While creating the user we used the `TryCreate` function to validate and create the corresponding `Username` type. In case of any validation errors we populated the `Failure` part of the `Result` type with the appropriate error message of type `string`. 

Now, when we read the user from the database, ideally there shouldn't be any validation errors. But we can't gurentee this behaviour as the underlying the database table can be accessed and modified without using our validation pipeline. 

In case, if the validation fails, it should be treated as a fatal error! 

> We may not need this level of robustness but the objective here is to domenstrate how to build a strong system using F#. 

So, the function that we need has to have the following signature 

```fsharp
string -> Result<Username, Exception>
```

As we will be using this function in the `asyncTrial` computation expression, it would be helpful if we return it as an `AsyncResult` instead of `Result` 

```fsharp
string -> AsyncResult<Username, Exception>
```

If we compare this function signature with that of the `TryCreate` function

```fsharp
string -> Result<Username, string> 
string -> AsyncResult<Username, Exception> 
```

we can get a clue that the we just need to map the failure type to `Exception` from `string` and lift `Result` to `AsyncResult`. 

We already have a function called `mapFailure` to map the failure type but it is defined after the definition of `Username`. To use it, we first move it before the `Username` type definition 

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Domain =
  // ...
  let mapFailure f aResult = 
    let mapFirstItem xs = 
      List.head xs |> f |> List.singleton 
    mapFailure mapFirstItem aResult

  type Username = // ...
  // ...
```

and then define the function `TryCreateAsync` using it

```fsharp
type Username = // ...
  // ...
  static member TryCreateAsync username =
    Username.TryCreate username // Result<Username, string> 
    |> mapFailure (System.Exception) // Result<Username, Exception>
    |> Async.singleton // Async<Result<Username, Exception>>
    |> AR // AsyncResult<Username, Exception>
``` 

Back to the `verifyUser` function, we can now return the `Username` if user verification succeeds

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Persistence = 
  // ...
  let verifyUser ... = asyncTrial {
    // ...
    | Some user ->
      // ...
      let! username = 
        Username.TryCreateAsync user.Username
      return Some username
  } 
```

The next step is wiring up this persistence logic with the presentation layer. 