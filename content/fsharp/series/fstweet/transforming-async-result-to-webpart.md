---
title: "Transforming Async Result to Webpart"
date: 2017-08-30T04:43:18+05:30
tags: [Chessie, rop, suave, fsharp]
---

Hi there!

In the [last post]({{< relref "orchestrating-user-signup.md" >}}), using the Chessie library, we orchestrated the user signup process. 

There are three more things that we need to do wrap up the user signup workflow.

1. Providing implementation for creating a new user in PostgreSQL

2. Integrating with an email provider to send the signup email

3. Adding the presentation layer to inform the user about his/her progress in the signup process. 


In this blog post, we are going to pick the third item. We will be faking the implementation of user creation and sending an email. 


## Domain To Presentation Layer
 
We have seen the expressive power of functions which transform a value from one type to an another in the previous post. 

We can apply the same thing while creating a presentation layer for a domain construct. 

Let's take our scenario.

The domain layer returns `AsyncResult<UserId, UserSignupError>` and the presentation layer needs `WebPart` as we are using Suave.

So, all we need is a function with the following signature. 

```fsharp
UserSignupViewModel -> 
  AsyncResult<UserId, UserSignupError> -> Async<WebPart>
```

The `UserSignupViewModel` is required communicate the error details with the user along with the information that he/she submitted. 

Let's start our implementation by creating a new function `handleUserSignupAsyncResult` in the `Suave` module.

```fsharp
// UserSignup.fs
...
module Suave =
  // ...
  let handleUserSignupAsyncResult viewModel aResult = 
    // TODO
  
  let handleUserSignup ... = // ...
```

> We are using the prefix `handle` instead of `map` here as we are going to do a side effect (printing in console in case of error) in addition to the transforming the type.

The first step is transforming 

```fsharp
AsyncResult<UserId, UserSignupError>
```
to

```fsharp
Async<Result<UserId, UserSignupError>>
```

As we seen in the previous post, we can make use of the `ofAsyncResult` function from Chessie, to do it

```fsharp
let handleUserSignupAsyncResult viewModel aResult = 
  aResult
  |> Async.ofAsyncResult
  // TODO
```

The next step is transforming 

```fsharp
Async<Result<UserId, UserSignupError>>
```
to

```fsharp
Async<WebPart>
```

As we did for [mapping Async Failure]({{< relref "orchestrating-user-signup.md#mapping-asyncresult-failure-type">}}) in the previous post, We make use of the `map` function on the Async module to carry out this transformation.

Let's assume that we have a method `handleUserSignupResult` which maps a `Result` type to `WebPart`

```fsharp
UserSignupViewModel -> Result<UserId, UserSignupError> -> WebPart
```

We can complete the `handleUserSignupAsyncResult` function as

```fsharp
let handleUserSignupAsyncResult viewModel aResult = 
  aResult
  |> Async.ofAsyncResult
  |> Async.map (handleUserSignupResult viewModel)
```

> The `map` function in the `Async` module is an extension provided by the Chessie library, and it is not part of the standard `Async` module

Now we have a scaffolding for transforming the domain type to the presentation type. 

## Transforming UserSignupResult to WebPart

In this section, we are going to define the `handleUserSignupResult` function that we left as a placeholder in the previous section. 

We are going to define it by having separate functions for handling success and failures and then use them in the actual definition of `handleUserSignupResult`

If the result is a success, we need to redirect the user to a signup success page. 

```fsharp
// UserSignup.fs
...
module Suave =
  // ...
  let handleUserSignupSuccess viewModel _ =
    sprintf "/signup/success/%s" viewModel.Username
    |> Redirection.FOUND 
  // ...
```

We are leaving the second parameter as `_`, as we are not interested in the result of the successful user signup (`UserId`) here.   

We will be handing the path `/signup/success/{username}` [later in this blog post]({{< relref "transforming-async-result-to-webpart.md#adding-signup-success-page" >}}). 

In case of failure, we need to account for two kinds of error 

1. Create User Error

2. Send Email Error

let's define separate functions for handing each kind of error.

```fsharp
module Suave =
  // ...
  let handleCreateUserError viewModel = function 
  | EmailAlreadyExists ->
    let viewModel = 
      {viewModel with Error = Some ("email already exists")}
    page signupTemplatePath viewModel
  | UsernameAlreadyExists ->
    let viewModel = 
      {viewModel with Error = Some ("username already exists")}
    page signupTemplatePath viewModel
  | Error ex ->
    printfn "Server Error : %A" ex
    let viewModel = 
      {viewModel with Error = Some ("something went wrong")}
    page signupTemplatePath viewModel
  // ...
```

We are updating the `Error` property with the appropriate error messages and re-render the signup page in case of unique constraint violation errors. 

For exceptions, which we modeled as `Error` here, we re-render the signup page with an error message as *something went wrong* and printed the actual error in the console. 

Ideally, we need to have a logger to capture these errors. We will be implementing them in an another blog post. 

We need to do the similar thing for handling error while sending emails.

```fsharp
module Suave =
  // ...
  let handleSendEmailError viewModel err =
    printfn "error while sending email : %A" err
    let msg =
      "Something went wrong. Try after some time"
    let viewModel = 
      {viewModel with Error = Some msg}
    page signupTemplatePath viewModel
  // ...
```

> To avoid the complexity, we are just printing the error. 

Then define the `handleUserSignupError` function which handles the `UserSignupError` using the two functions that we just defined.

```fsharp
module Suave =
  // ...
  let handleUserSignupError viewModel errs = 
    match List.head errs with
    | CreateUserError cuErr ->
      handleCreateUserError viewModel cuErr
    | SendEmailError err ->
      handleSendEmailError viewModel err
  // ...
```

The `errs` parameter is a list of `UserSignupError` as the Result type models failures as lists. 

In our application, we are treating it as a list with one error.

Now we have functions to transform both the Sucess and the Failure part of the `UserSignupResult`. 

With the help of these functions, we can define the `handleUserSignupResult` using the [either](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-trial.html) function from Chessie

```fsharp
// UserSignup.fs
...
module Suave =
  // ...
  let handleUserSignupResult viewModel result =
    either 
      (handleUserSignupSuccess viewModel)
      (handleUserSignupError viewModel) result
  // ...
```

With this, we are done with the following transformation.

```fsharp
AsyncResult<UserId, UserSignupError> -> Async<WebPart>
```

## Wiring Up WebPart

In the previous section, we defined functions to transform the result of a domain functionality to its corresponding presentation component.

The next work is wiring up this presentation component with the function which handles the user signup `POST` request. 

As a recap, here is a skeleton of the request handler function that we already defined in the [fifth part]({{< relref "user-signup-validation.md#showing-validation-error">}}) of this blog series.

```fsharp
let handleUserSignup ctx = async {
  match bindEmptyForm ctx.request with
  | Choice1Of2 (vm : UserSignupViewModel) ->
    let result = // ...
    let onSuccess (signupUserRequest, _) = 
      printfn "%A" signupUserRequest
      Redirection.FOUND "/signup" ctx
    let onFailure msgs = 
      let viewModel = 
        {vm with Error = Some (List.head msgs)}
      page "user/signup.liquid" viewModel ctx
    return! either onSuccess onFailure result
  | Choice2Of2 err ->
    // ..
  // ...
}
```

As a first step towards wiring up the user signup result, we need to use the pattern matching on the validation result instead of using the `either` function. 

```fsharp
let handleUserSignup ctx = async {
  // ...
  | Choice1Of2 (vm : UserSignupViewModel) ->
    match result with
    | Ok (userSignupReq, _) ->
      printfn "%A" signupUserRequest
      Redirection.FOUND "/signup" ctx
      return! webpart ctx
    | Bad msgs ->
      let viewModel = 
        {vm with Error = Some (List.head msgs)}
      page "user/signup.liquid" viewModel ctx
  | Choice2Of2 err -> // ...
  // ...
}
```

The reason for this split is we will be doing an asynchronous operation if the request is valid. For the invalid request, there is no asynchronous operation involved. 

The next step is changing the signature of the `handleUserSignup` to take `signupUser` function as its parameter 

```fsharp
let handleUserSignup signupUser ctx = async {
  // ...
}
```

This `signupUser` is a function with the signature

```fsharp
UserSignupRequest -> AsyncResult<UserId, UserSignupError>
```

> It is equivalent to the `SignupUser` type, without the dependencies
```fsharp
type SignupUser = 
    CreateUser -> SendSignupEmail -> 
      UserSignupRequest -> AsyncResult<UserId, UserSignupError>
      
```


Then in the pattern matching part of the valid request, replace the placeholders (printing and redirecting) with the actual functionality

```fsharp
let handleUserSignup signupUser ctx = async {
  // ...
  | Choice1Of2 (vm : UserSignupViewModel) ->
    match result with
    | Ok (userSignupReq, _) ->
      let userSignupAsyncResult = signupUser userSignupReq
      let! webpart =
        handleUserSignupAsyncResult vm userSignupAsyncResult
      return! webpart ctx
  // ...
}
```

For valid signup request, we call the `signupUser` function and then pass the return value of this function to the `handleUserSignupAsyncResult` function which returns an  `Async<WebPart>`

Through `let!` binding we retrieve the `WebPart` from `Async<WebPart>` and then using it to send the response back to the user. 

> `WebPart` is a type alias of a function with the signature 
  ```fsharp
  HttpContext -> Async<HttpContext option>
  ```

## Adding Fake Implementations for Persistence and Email

As mentioned earlier, we are going to implement the actual functionality of `CreateUser` and `SendSignupEmail` in the later blog posts. 

But that doesn't mean we need to wait until the end to see the final output in the browser. 

These two types are just functions! So, We can provide a fake implementation of them and exercise the functionality that we wrote!

Let's add two more modules above the `Suave` module with these fake implementations. 

```fsharp
// UserSignup.fs
// ...
module Persistence =
  open Domain
  open Chessie.ErrorHandling

  let createUser createUserReq = asyncTrial {
    printfn "%A created" createUserReq 
    return UserId 1
  }
    
module Email =
  open Domain
  open Chessie.ErrorHandling

  let sendSignupEmail signupEmailReq = asyncTrial {
    printfn "Email %A sent" signupEmailReq
    return ()
  }
// ...
```

The next step is using the fake implementation to complete the functionality

```fsharp
// ...
module Suave =
  // ...
  let webPart () =
    let createUser = Persistence.createUser
    let sendSignupEmail = Email.sendSignupEmail
    let signupUser = 
      Domain.signupUser createUser sendSignupEmail
    path "/signup" 
      >=> choose [
        // ...
        POST >=> handleUserSignup signupUser
      ]
```

There are two patterns that we have employed here. 

* Dependency Injection using Partial Application

  > We partially applied the first two parameters of the `signupUser` function to inject the dependencies that are responsible for creating the user and sending the signup email. Scott Wlaschin has written [an excellent article](https://fsharpforfunandprofit.com/posts/dependency-injection-1/) on this subject. 

* [Composition Root](http://blog.ploeh.dk/2011/07/28/CompositionRoot/)


Now we can run the application.

If we try to signup with a valid user signup request, we will get the following output in the console 

```bash
{Username = Username "demystifyfp";
 PasswordHash =
  PasswordHash "$2a$10$UZczy11hA0e/2v0VlrmecehGlWv/OlxBPyFEdL4vObxAL7wQw0g/W";
 Email = EmailAddress "demystifyfp@gmail.com";
 VerificationCode = VerificationCode "oCzBXDY5wIyGlNFuG76a";} created
Email {Username = Username "demystifyfp";
 EmailAddress = EmailAddress "demystifyfp@gmail.com";
 VerificationCode = VerificationCode "oCzBXDY5wIyGlNFuG76a";} sent
```

and in the browser, we will get an empty page

![Signup Success Page Not Found](/img/fsharp/series/fstweet/signup-sucess-not-found.png)

## Adding Signup Success Page

The final piece of work is adding a signup success page

Create a new liquid template in the `views/user` directory

```html
<!-- views/user/signup_success.liquid -->
{% extends "master_page.liquid" %}

{% block head %}
  <title> Signup Success </title>
{% endblock %}

{% block content %}
<div class="container">
  <p class="well"> 
    Hi {{ model }}, Your account has been created. 
    Check your email to activate the account. 
  </p>
</div>
{% endblock %}
```

This liquid template makes use of view `model` of type string to display the user name

The next step is adding a route for rendering this template with the actual user name in the `webpart` function. 

As we are now exposing more than one paths in user signup (one for the request and another for the successful signup), we need to use the `choose` function to define a list of `WebPart`s. 

```fsharp
// UserSignup.fs
// ...
module Suave =
  let webPart () =
    // ...
    choose [
      path "/signup" 
        // ...
      pathScan 
        "/signup/success/%s" 
        (page "user/signup_success.liquid")
    ]
```

The [pathScan](https://suave.io/Suave.html#def:val Suave.Filters.pathScan) from Suave enable us to do strongly typed pattern matching on the route. It takes a string (route) with `PrintfFormat` string and a function with parameters matching the values in the route. 

Here the user name is being matched on the route. Then we partially apply page function with one parameter representing the path of the liquid template. 

Now if we run the application, we will get the following page upon receiving a valid user signup request.

![Signup sucess](/img/fsharp/series/fstweet/singup-sucess.png)

That's it :)

## Summary

In this blog post, we learned how to transform the result representation of a domain functionality to its corresponding view layer representation. 

The separation of concerns enables us to add a new Web RPC API or even replacing Suave with any other library/framework without touching the existing functionality. 

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.7)


### Next Part

[Persisting New User]({{<relref "persisting-new-user.md">}})