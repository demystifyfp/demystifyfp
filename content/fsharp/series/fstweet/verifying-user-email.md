---
title: "Verifying User Email"
date: 2017-09-17T13:27:49+05:30
tags: [suave, chessie, rop, fsharp]
---

Hi,

In the previous blog post, we added support for [sending verification email]({{< relref "sending-verification-email.md" >}}) using [Postmark](https://postmarkapp.com/). 

In this blog post, we are going to wrap up the user signup workflow by implementing the backend logic of the user verifcation link that we sent in the email. 


## A Type For The Verify User Function.

Let's get started by defining a type for the function which verifies the user. 

```fsharp
type VerifyUser = string -> AsyncResult<Username option, System.Exception>
``` 

It takes a verification code of type `string` and asynchronously returns either `Username option` or an exception if there are any fatal errors while verifying the user. 

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

The first parameter `getDataCtx` represents the factory function to get the SQLProvider's datacontext that [we implemented]({{< relref "persisting-new-user.md#datacontext-one-per-request" >}}) while persisting a new user. When we partially applying this argument alone, we will get a function of type `VerifyUser`

We first need to query the `Users` table to get the user associated with the verification code provided. 

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

Like `SubmitUpdatesAsync` function, the `tryHeadAsync` throws exceptions if there is an error during the execution of the query. So, we need to catch the exception and return it as an `AsyncResult`.

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

This implementation to very similar to what we did in the implementation of the [submitUpdates]({{< relref "persisting-new-user.md#async-exception-to-async-result" >}}) function.


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

The last step is returning the username of the User to let the caller of the `verifyUser` function know that the user has been verified and greet the user with the username. 

We already have a domain type `Username` to represent the username. But the type of the username that we retrieved from the database is a `string`. 

So, We need to convert it from `string` to `Username`. To do it we defined a static function on the `Username` type, `TryCreate`, which takes a `string` and returns `Result<Username, string>`. 

We could use this function here but before committing, let's ponder over the scenario. 

While creating the user we used the `TryCreate` function to validate and create the corresponding `Username` type. In case of any validation errors, we populated the `Failure` part of the `Result` type with the appropriate error message of type `string`. 

Now, when we read the user from the database, ideally there shouldn't be any validation errors. But we can't guarantee this behavior as the underlying the database table can be accessed and modified without using our validation pipeline. 

In case, if the validation fails, it should be treated as a fatal error! 

> We may not need this level of robustness, but the objective here is to demonstrate how to build a robust system using F#. 

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

we can get a clue that we just need to map the failure type to `Exception` from `string` and lift `Result` to `AsyncResult`. 

We already have a function called `mapFailure` to map the failure type, but it is defined after the definition of `Username`. To use it, we first move it before the `Username` type definition. 

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

## The Presentation Side of User Verification

We are returning `Username option` when the user verification completed without any errors. If it has a value, We need to show a success page otherwise we can show a not found page.

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Suave = 
  // ...
  
  // (Username option * 'a) -> WebPart
  let onVerificationSuccess (username, _ )=
    match username with
    | Some (username : Username) ->
      page "user/verification_success.liquid" username.Value
    | _ ->
      page "not_found.liquid" "invalid verification code"
``` 

> We are using a tuple of type `(Username option * 'a)` as an input parameter here as the Success side of the `Result` type is [a tuple of two values](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-result-2.html), success and warning. As we are not using warning here, we can ignore. We will be refactoring it in an another blog post. 

Let's add these two liquid template files. 

```html
<!-- FsTweet.Web/views/user/verification_success.liquid -->
{% extends "master_page.liquid" %}

{% block head %}
  <title> Email Verified </title>
{% endblock %}

{% block content %}

  Hi {{ model }}, Your email address has been verified. 
  Now you can <a href="/login">login</a>!

{% endblock %}
```

```html
<!-- FsTweet.Web/views/not_found.liquid -->
{% extends "master_page.liquid" %}

{% block head %}
  <title> Not Found :( </title>
{% endblock %}

{% block content %}
  {{model}} 
{% endblock %}
```

In case of errors during user verification, we need to log the error in the console and render a generic error page to user

```fsharp
module Suave = 
  // ...

  // System.Exception list -> WebPart
  let onVerificationFailure errs =
    let ex : System.Exception = List.head errs
    printfn "%A" ex
    page "server_error.liquid" "error while verifying email"
```

> The input parameter `errs` is of type `System.Exception list` as the failure type of `Result` is a list of error type, and we are using it as a list with the single value. 

Then add the liquid template for the showing the server error

```html
<!-- FsTweet.Web/views/server_error.liquid -->
{% extends "master_page.liquid" %}

{% block head %}
  <title> Internal Error :( </title>
{% endblock %}

{% block content %}
  {{model}} 
{% endblock %}
```

Now we have functions that map success and failure parts of the `Result` to its corresponding `WebPart`.

The next step is using these two functions to map `AsyncResult<Username option, Exception>` to `Async<WebPart>`

```fsharp
module Suave = 
  // ...
  let handleVerifyUserAsyncResult aResult =
    aResult // AsyncResult<Username option, Exception>
    |> Async.ofAsyncResult // Async<Result<Username option, Exception>>
    |> Async.map 
      (either onVerificationSuccess onVerificationFailure) // Async<WebPart>
```

Now the presentation side is ready; the next step is wiring the persistence and the presentation layer. 


## Adding Verify Signup Endpoint

As a first step, let's add a route and a webpart function for handling the signup verify request from the user. 

```fsharp
module Suave =
  // ...
  let webPart getDataCtx sendEmail =
    // ...
    let verifyUser = Persistence.verifyUser getDataCtx
    choose [
      // ...
      pathScan "/signup/verify/%s" (handleSignupVerify verifyUser)
    ]
```

The `handleSignupVerify` is not defined yet, so let's add it above the `webPart` function

```fsharp
module Suave =
  // ...
  let handleSignupVerify 
    (verifyUser : VerifyUser) verificationCode ctx = async {
      // TODO
  }
```

This function first verifies the user using the `verificationCode`

```fsharp
let handleSignupVerify ... = async {
  let verifyUserAsyncResult = verifyUser verificationCode
  // TODO
}
```

Then map the `verifyUserAsyncResult` to the webpart using the `handleVerifyUserAsyncResult` function we just defined

```fsharp
let handleSignupVerify ... = async {
  let verifyUserAsyncResult = verifyUser verificationCode
  let! webpart = handleVerifyUserAsyncResult verifyUserAsyncResult
  // TODO
}
```

And finally call the webpart function

```fsharp
let handleSignupVerify ... = async {
  let verifyUserAsyncResult = verifyUser verificationCode
  let! webpart = handleVerifyUserAsyncResult verifyUserAsyncResult
  return! webpart ctx
}
```

## Summary

With this blog post, we have completed the user signup workflow. 

I hope you found it useful and learned how to put the pieces together to build fully functional feature robustly. 

The source code of this part can be found on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.10)

## Exercise

How about sending a welcome email to the user upon successful verification of his/her email?

