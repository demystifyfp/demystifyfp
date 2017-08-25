---
title: "Validating New User Signup Form"
date: 2017-08-25T08:34:25+05:30
tags: [suave, chessie, rop,fsharp]
---

Hi,

Welcome to the fifth part of the [Creating a Twitter Clone in F# using Suave](TODO) blog post series.

In the [previous blog post]({{< relref "user-signup.md" >}}), we created the server side representation of the user submitted details. The next step is validating this view model against a set of constraints before persisting them in a data store. 

## Transforming View Model To Domain Model

In F#, a widely used approach is defining a domain model with the illegal states unrepresentable and transform the view model to the domain model before proceeding with the next set of actions. 

Let's take the `Username` property of the `UserSignupViewModel` for example. 

It is of type `string`. The reason why we have it as a `string` is to enable model binding with ease. That means, `Username` can have `null`, `""` or even a very long string! 

Let's assume that we have a business requirement stating the username should not be empty, and it can't have more than `12` characters. An ideal way to represent this requirement in our code is to type called `Username` and when we say a value is of type `Username` it is guaranteed that all the specified requirements for `Username` has been checked and it is a valid one. 

It is applicable for the other properties as well. 

`Email` should have a valid email address, and `Password` has to meet the application's password policy.

Let's assume that we have a function `tryCreate` that takes `UserSignupViewModel` as its input, performs the validations based on the requirements and returns either a domain model `UserSignupRequest` or a validation error of type `string`.

![View Model to Domain Model](/img/fsharp/series/fstweet/vm_to_dm.png)

The subsequent domain actions will take `UserSignupRequest` as its input without bothering about the validness of the input!

If we zoom into the `tryCreate` function, it will have three `tryCreate` function being called sequentially. Each of these functions takes care of validating the individual properties and transforming them into their corresponding domain type. 

![Happy Path](/img/fsharp/series/fstweet/happy_path.png)

If we encounter a validation error in any of these internal functions, we can short circuit and return the error that we found.

![Error Path](/img/fsharp/series/fstweet/error_path.png)

> In some cases, we may need to capture all the errors instead of short circuiting and returning the first error that we encountered. We can see that approach in an another blog post

This validation and transformation approach is an implementation of a functional programming abstraction called [Railway Oriented Programming](https://fsharpforfunandprofit.com/rop/). 

## The Chessie Library

[Chessie](http://fsprojects.github.io/Chessie/) is an excellent library for doing Railway Oriented Programming in fsharp. 

Let's get started with the validation by adding the `Chessie` package.

```bash
> forge paket add Chessie -p src/FsTweet.Web/FsTweet.Web.fsproj
```

## Making The Illegal States Unrepresentable

As a first step, create a new module `Domain` in the *UserSignup.fs* and make sure it is above the `Suave` module.

```fsharp
namespace UserSignup
module Domain =
  // TODO
```

Then define a single case discriminated union with a `private` constructor for the domain type `Username`

```fsharp
module Domain =
  type Username = private Username of string
```

The `private` constructor ensures that we can create a value of type `Username` only inside the `Domain` module. 

Then add the `tryCreate` function as a static member function of `Username`

```fsharp
module Domain =
  open Chessie.ErrorHandling

  type Username = private Username of string with
    static member TryCreate (username : string) =
      match username with
      | null | ""  -> fail "Username should not be empty"
      | x when x.Length > 12 -> 
        fail "Username should not be more than 12 characters"
      | x -> Username x |> ok
```

As we saw in the previous function, the `TryCreate` function has the following function signature

```fsharp
string -> Result<Username, string list>
```

The `Result`, a type from the `Chessie` library, [represents](http://fsprojects.github.io/Chessie/reference/chessie-errorhandling-result-2.html) the result of our validation. It will have either the `Username` (if the input is valid) or a `string list` (for invalid input)

> The presence `string list` instead of just `string` is to support an use case where we are interested in capturing all the errors. As we are going to capture only the first error, we can treat this as a `list` with only one `string`.

The `ok` and `fail` are helper functions from `Chessie` to wrap our custom values with the `Success` and `Failure` part of the `Result` type respectively.  

As we will need the `string` representation of the `Username` to persist it in the data store, let's add a [property](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/members/properties) `Value` which returns the underlying actual `string` value. 

```fsharp
module Domain =
  // ...
  type Username = private Username of string with
    // ...
    member this.Value = 
      let (Username username) = this
      username
```

Let's do the same thing with the other two input that we are capturing during the user signup 

```fsharp
module Domain =
  // ... 
  type EmailAddress = private EmailAddress of string with
    member this.Value =
      let (EmailAddress emailAddress) = this
      emailAddress
    static member TryCreate (emailAddress : string) =
     try 
       new System.Net.Mail.MailAddress(emailAddress) |> ignore
       EmailAddress emailAddress |> ok
     with
       | _ -> fail "Invalid Email Address"
```

```fsharp
module Domain =
  // ...
  type Password = private Password of string with 
    member this.Value =
      let (Password password) = this
      password
    static member TryCreate (password : string) =
      match password with
      | null | ""  -> fail "Password should not be empty"
      | x when x.Length < 4 || x.Length > 8 -> 
        fail "Password should contain only 4-8 characters"
      | x -> Password x |> ok
```

Now we have all individual validation and transformation in place. The next step is composing them together and create a new type `SignupUserRequest` that represents the valid domain model version of the `SignupUserViewModel`

```fsharp
module Domain =
  // ...
  type SignupUserRequest = {
    Username : Username
    Password : Password
    EmailAddress : EmailAddress
  }
```

How do we create `SignupUserRequest` from `SignupUserViewModel`?

With the help of [trial](http://fsprojects.github.io/Chessie/reference/chessie-errorhandling-trial-trialbuilder.html), a [computation expression](https://fsharpforfunandprofit.com/series/computation-expressions.html)(CE) builder from `Chessie` and the `TryCreate` functions that we created earlier we can achieve it with ease.

```fsharp
module Domain =
  // ...
  type SignupUserRequest = {
    // ...
  }
  with static member TryCreate (username, password, email) =
        trial {
          let! username = Username.TryCreate username
          let! password = Password.TryCreate password
          let! emailAddress = EmailAddress.TryCreate email
          return {
            Username = username
            Password = password
            EmailAddress = emailAddress
          }
        }
```

The `TryCreate` function in the `SignupUserRequest` takes a tuple with three elements and returns a `Result<SignupUserRequest, string list>`

The `trail` CE takes care of short circuiting if it encounters a validation error. 

> We might require some of the types that we have defined in the `Domain` module while implementing the upcoming features. We will be moving the common types to a shared `Domain` module as and when needed.

## Showing Validation Error 

We are done with the domain side of the UserSignup and one pending step is communicating the validation error with the user. 

We already have an `Error` property in `UserSignupViewModel` for this purpose. So, we just need to get the error from the `Result` type and populate it. 

The `Chessie` library has a function called `either`.

```fsharp
either fSuccess fFailure trialResult
``` 

It takes three parameters, two functions `fSuccess` and `fFailure` and a `Result` type. 

It maps the `Result` type with `fSuccess` if it is a Success otherwise it maps it with `fFailure`.

```fsharp
module Suave =
  // ...
  open Domain
  open Chessie.ErrorHandling
  // ...
  let handleUserSignup ctx = async {
    match bindEmptyForm ctx.request with
    | Choice1Of2 (vm : UserSignupViewModel) ->
      let result =
        SignupUserRequest.TryCreate (vm.Username, vm.Password, vm.Email)
      let onSuccess (signupUserRequest, _) =
        printfn "%A" signupUserRequest
        Redirection.FOUND "/signup" ctx
      let onFailure msgs =
        let viewModel = {vm with Error = Some (List.head msgs)}
        page "user/signup.liquid" viewModel ctx
      return! either onSuccess onFailure result
    // ...
  }
  // ...
```

In our case, in case of success, as a dummy implementation, we just print the `SignupUserRequest` and redirect to the *signup* page again.

During failure, we populate the `Error` property of the view model with the first item in the error messages list and re-render the *signup* page again.

As we are referring the liquid template path of the signup page in three places now, let's create a label for this value and use the label in all the places.

```fsharp
module Suave =
  // ..
  let signupTemplatePath = "user/signup.liquid" 

  let handleUserSignup ctx = async {
    match bindEmptyForm ctx.request with
    | Choice1Of2 (vm : UserSignupViewModel) ->
      // ...
      let onFailure msgs =
        // ...
        page signupTemplatePath viewModel ctx
      // ...
    | Choice2Of2 err ->
      // ...
      return! page signupTemplatePath viewModel ctx
  }

  let webPart () =
    path "/signup" 
      >=> choose [
        GET >=> page signupTemplatePath emptyUserSignupViewModel
        // ...
      ]
```

Now if we build and run the application, we will be getting following console output for valid signup details.

```bash
{Username = Username "demystifyfp";
 Password = Password "secret";
 EmailAddress = EmailAddress "demystifyfp@gmail.com";}
```

## Summary

In this part, we learned how to do validation and transform view model to a domain model using the Railway Programming technique with the help of the `Chessie` library.

The source code for this part is available in [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.4)