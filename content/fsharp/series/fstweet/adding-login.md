---
title: "Adding Login Page"
date: 2017-09-23T15:47:03+05:30
tags: [suave, chessie, rop,fsharp]
---

Hi!

Welcome back to the thirteenth part of [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}) blog post series. 

In this blog post, we are going to start the implementation of a new feature, enabling users to log in to FsTweet. 

Let's get started by creating a new file *Auth.fs* in the `web` project and move it above *FsTweet.Web.fs*

```bash
> forge newFs web -n src/FsTweet.Web/Auth
> forge moveUp web -n src/FsTweet.Web/Auth.fs
```

## Serving The Login Page

The first step is rendering the login page in response to the `/login` HTTP GET request. As we did for the user signup, we are going to have multiple modules in the `Auth.fs` representing different layers of the application. 


To start with, let's create a module `Suave` with a view model for the login page.

```fsharp
// FsTweet.Web/Auth.fs
namespace Auth
module Suave =
  type LoginViewModel = {
    Username : string
    Password : string
    Error : string option
  }
```

As we seen in the `UserSignupViewModel`, we need an empty view model while rendering the login page for the first time.

```fsharp
module Suave =
  // ...
  let emptyLoginViewModel = {
    Username = ""
    Password = ""
    Error = None
  }
```

Then we need to create a liquid template for the login page. 

Let's create a new file `user/login.liquid` in the *views* directory

```html
<!-- FsTweet.Web/views/user/login.liquid -->
{% extends "master_page.liquid" %}

{% block head %}
  <title> Login </title>
{% endblock %}

{% block content %}
<div>
  <p class="alert alert-danger">
    {{ model.Error.Value }}
  </p>
  <form method="POST" action="/login">   
    <input 
      type="text" id="Username" name="Username" 
      value="{{model.Username}}" required>

    <input 
      type="password" id="Password" name="Password" 
      value="{{model.Password}}" required>

    <button type="submit">Login</button>
  </form>
</div>
{% endblock %}
```

> For brevity, the styles and some HTML tags are ignored.

The next step is creating a new function to render this template with a view model. 

```fsharp
// FsTweet.Web/Auth.fs
module Suave =
  open Suave.DotLiquid
  // ...
  let loginTemplatePath = "user/login.liquid"

  let renderLoginPage (viewModel : LoginViewModel) = 
    page loginTemplatePath viewModel
```

Then create a new function `webpart` to wire this function with the `/login` path

```fsharp
module Suave =
  // ...
  open Suave.Filters
  open Suave.DotLiquid
  // ...

  let webpart () =
    path "/login" 
      >=> renderLoginPage emptyLoginViewModel
```

The last step is calling this `webpart` function from the `main` function and append this webpart to the application's webpart list.

```fsharp
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  // ...
  let app = 
    choose [
      // ...
      Auth.Suave.webpart ()
    ]
  // ...
```

That's it!

If we run the application now, you can see a beautiful login page

![Login Page](/img/fsharp/series/fstweet/login.png)

## Handling the Login Request

To handle the HTTP POST request on `/login`, let's create a new function `handleUserLogin` (aka `WebPart`) and wire it up in the `webpart` function

```fsharp
// FsTweet.Web/Auth.fs
module Suave =
  // ...
  let handleUserLogin ctx = async {
    // TODO
  }
  // ...
```

```diff
module Suave =
+ open Suave
// ...  

let webpart () =
- path "/login" 
-   >=> renderLoginPage emptyLoginViewModel
+ path "/login" >=> choose [
+   GET >=> renderLoginPage emptyLoginViewModel
+   POST >=> handleUserLogin
+ ]
```

To handle the request for login, we first need to bind the submitted form values to a value of `LoginViewModel` 

```fsharp
let handleUserLogin ctx = async {
  match bindEmptyForm ctx.request with
  | Choice1Of2 (vm : LoginViewModel) ->
    // TODO
  | Choice2Of2 err ->
    // TODO
}
```

If there is an error while doing model binding, we can populate the `Error` field of an empty `LoginViewModel` and rerender the login page

```diff
let handleUserLogin ctx = async {
  match bindEmptyForm ctx.request with
  | Choice1Of2 (vm : LoginViewModel) ->
    // TODO
  | Choice2Of2 err ->
+   let viewModel = 
+     {emptyLoginViewModel with Error = Some err}
+   return! renderLoginPage viewModel ctx
}
```

If the model binding is successful, we need to validate the incoming `LoginViewModel`. 

## Validating the Login Request

The `username` and the `password` fields of the `LoginViewModel` are of types `string`. But what we want to carry out the login operation is their corresponding domain models `Username` and `Password`. 

Let's define a new module `Domain` in *Auth.fs* above `Suave` and define a domain type for the login request.

```fsharp
// FsTweet.Web/Auth.fs
namespace Auth

module Domain =
  open User
  type LoginRequest = {
    Username : Username
    Password : Password
  }

module Suave = 
  // ...
```

Then define a static member function `TryCreate` which creates `LoginRequest` using the `trial` computation expression and the `TryCreate` functions of `Username` and `Password` type.

```fsharp
module Domain =
  open Chessie.ErrorHandling
  // ...
  type LoginRequest = // ...
  
  // (string * string) -> Result<LoginRequest,string>
  with static member TryCreate (username, password) = 
        trial {
          let! username = Username.TryCreate username
          let! password = Password.TryCreate password
          return {
            Username = username
            Password = password
          }
        }
```

Then in the `handleUserLogin` function, we can make use of this function to validate the `LoginViewModel`. 

```fsharp
module Suave =
  open Chessie
  // ...
  let handleUserLogin ctx = async {
    // ...
    | Choice1Of2 (vm : LoginViewModel) ->
      let result = 
        LoginRequest.TryCreate (vm.Username, vm.Password)
      match result with
      | Success req -> 
        // TODO
      | Failure err ->
        let viewModel = {vm with Error = Some err}
        return! renderLoginPage viewModel ctx
    // ...
  }
```

The Success and Failure active pattern that [we defined in the previous post]({{< relref "reorganising-code-and-refactoring.md#pattern-matching-on-result-type">}}) made our job easier here to pattern match on the `Result<LoginRequest,string>` type. 

If there is any error, we populate the view model with the error message and rerender the login page. 

For a valid login request, we need to implement the actual behavior. Let's leave this as a `TODO` and revisit it in the next blog post.


## Summary

In this blog post, we added implementations for rending the login page. Then we added functions to handle and validate the login request from the user. 

The source code is available in the [GitHub repository](https://github.com/demystifyfp/FsTweet/tree/v0.12) 

### Next Part

[Handling Login Request]({{<relref "handling-login-request.md">}})