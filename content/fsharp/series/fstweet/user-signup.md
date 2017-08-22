---
title: "Handling User signup Form and Validation"
date: 2017-08-19T16:37:26+05:30
tags: [suave, chessie, forge]
---

In the [last blog post]({{< relref "static-assets.md" >}}), we added a cool landing page for *FsTweet* to increase the user signups. But the signup form and its backend are not ready yet!

In this fourth part, we will be extending *FsTweet* to serve the signup page and implement its backend HTTP backend without persistence

## A New File For User Signup

Let's get started by creating a new file *UserSignup.fs* in the *FsTweet.Web.fsproj* file using Forge.

```bash
> forge new file -t fs \
    -p src/FsTweet.Web/FsTweet.Web.fsproj \
    -n src/FsTweet.Web/UserSignup
```

The next step is moving this file above *FsTweet.Web.fs* file as we will be referring `UserSignup` in the `Main` function. 

Using Forge, we can achieve it using the following command

```bash
> forge move file -p src/FsTweet.Web/FsTweet.Web.fsproj \
    -n src/FsTweet.Web/UserSignup.fs -u
```

Though working with the command line is productive than its visual counterpart, the commands that we typed for creating and moving a file is verbose.

Forge has [an advanced feature called alias](https://github.com/fsharp-editing/Forge/wiki/aliases#alias-definition) using which we can get rid of the boilerplate to a large extent.

As we did for the forge [Run alias]({{< relref "project-setup.md" >}}) during the project setup, let's add few three more alias

```toml
# ...
  web='-p src/FsTweet.Web/FsTweet.Web.fsproj'
  newFs='new file -t fs'
  moveUp='move file -u'
```

The `web` is an alias for the project argument in the Forge commands. The `newFs` and `moveUp` alias are for the `new file` and `move file` operations respectively.

If we had this alias beforehand, we could have used the following commands to do what we just did

```bash
> forge newFs web -n src/FsTweet.Web/UserSignup
> forge moveUp web -n src/FsTweet.Web/UserSignup.fs
```

> We can generalize the alias as 
```bash
forge {operation-alias} {project-alias} {other-arguments}
```

## Serving User Signup Page

The first step is to serve the user signup page in response to the `/signup` request from the browser. 

As we will be capturing the user details during signup, we need to use an view model while using the dotliquid template for the signup page. 

In the *UserSignup.fs*, define a namespace `UserSignup` and a module `Suave` with a `webPart` function.

```fsharp
// FsTweet.Web/UserSignup.fs
namespace UserSignup

module Suave =

  open Suave.Filters
  open Suave.Operators
  open Suave.DotLiquid

  //
  let webPart () =
    path "/signup"                  
      >=> page "user/signup.liquid" ??? 
```

The namespace represents the use case or the feature that we are about to implement. The modules inside the namespace represent the different layers of the use case implementation. 

The `Suave` module defines the `Web` layer of the User Signup feature. You can learn about organizing modules from [this blog post](https://fsharpforfunandprofit.com/posts/recipe-part3/). 

The `???` symbol is a placeholder that we need to fill in with a view model. 

The view model has to capture user's email address, password, and username.

```fsharp
// FsTweet.Web/UserSignup.fs
module Suave = 
  type UserSignupViewModel = {
    Username : string
    Email : string
    Password: string
    Error : string option
  }  
  let emptyUserSignupViewModel = {
    Username = ""
    Email = ""
    Password = ""
    Error = None
  }
  let webPart () =
    path "/signup" 
      >=> page "user/signup.liquid" emptyUserSignupViewModel
```

As the name indicates, `emptyUserSignupViewModel` provide the default values for the view model.

The `Error` property in the `UserSignupViewModel` record type is to communicate an error with the view. 

The next step is creating a dotliquid template for the signup page. 

```html
<!-- FsTweet.Web/views/user/signup.liquid -->
{% extends "master_page.liquid" %}

{% block head %}
  <title> Sign Up - FsTweet </title>
{% endblock %}

{% block content %}
<form method="POST" action="/signup">
  {% if model.Error %}
    <p>{{ model.Error.Value }}</p>
  {% endif %}
  <input type="email" name="Email" value={{ model.Email }}>
  <input type="text" name="Username" value={{ model.Username }}>
  <input type="password" name="Password">
  <button type="submit">Sign up</button>
</form>
{% endblock %}
```

> For brevity, the styles and some HTML tags are ignored.

In the template, the `name` attribute with its corresponding view model's property name as value is required to do the model binding on the server side. 

And another thing to notice here is the `if` condition to display the error only if it is available. 

The last step in serving the user signup page is adding this new webpart in the application.

To do this, we just need to call the `webPart` function while defining the `app` in the `main` function. 

```fsharp
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  let app = 
    choose [
      // ...
      UserSignup.Suave.webPart ()
    ]
  // ...
```

That's it!

If we run the application and hit `http://localhost:8080/signup` in the browser, we can see the signup page

![User Signup Form](/img/fsharp/series/fstweet/signup-form.png)

## Handling Signup Form POST request

To handle the POST request during the signup form submission, we need to have a WebPart configured. 

On the same path `/signup` we need to have one WebPart for serving the signup page in response to GET request and an another for the POST request. 

```fsharp
// FsTweet.Web/UserSignup.fs
module Suave =
  // ...
  open Suave 
  // ...
  let webPart () =
    path "/signup" 
      >=> choose [
        GET >=> page "user/signup.liquid" emptyUserSignupViewModel
        POST >=> ???
      ]
```

To fill the placeholder `???`, let's add a new WebPart `handleUserSignup`, with a dummy implementation. 
```fsharp
// FsTweet.Web/UserSignup.fs
module Suave =
  // ...
  let handleUserSignup ctx = async {
    printfn "%A" ctx.request.form
    return! Redirection.FOUND "/signup" ctx
  }

  let webPart () =
    path "/signup" 
      >=> choose [
        // ...
        POST >=> handleUserSignup
      ]
```

The placeholder implementation of the `handleUserSignup` WebPart prints the form values posted (from the [request](https://suave.io/Suave.html#def:member Suave.Http.HttpRequest.form)) in the console and redirects the user again to the signup page.

When we rerun the program with this new changes, we can find the values being posted in the console upon submitting the signup form.

```bash
[("Email", Some "demystifyfp@gmail.com"); ("Username", Some "demystifyfp");
 ("Password", Some "secret"); ("Error", Some "")]
```

## Model Binding Using Suave.Experimental

In the previous section, the `handleUserSignup` WebPart got the form data that were posted using the `form` member of the `request`.

The `form` member is of type `(string * string option) list`.  

We already have view model in place `UserSignupViewModel` to represent the same data. The next step is converting the data  

```bash
from {(string * string option) list} to {UserSignupViewModel}
```

In other words, we need to bind the request form data to the `UserSignupViewModel`.

There is an inbuilt support for doing this Suave using `Suave.Experimental` package. 

Let's add this to our `FsTweet.Web` project using paket and forge.

```bash
> forge paket add Suave.Experimental
```
*src/FsTweet.Web/paket.references*
```bash
...
Suave.Experimental
```
```bash
> forge install
```

After we add the reference, we can make use of the `bindEmptyForm` function to carry out the model binding for us.

```fsharp
val bindEmptyForm<'a> : (req : HttpRequest) -> Choice<'a, string>
```

The `bindEmptyForm` function takes a request and returns either the value of the given type or an error message.

```fsharp
// ...
module Suave = 
  // ...
  open Suave.Form 
  // ...

  let handleUserSignup ctx = async {
    match bindEmptyForm ctx.request with
    | Choice1Of2 (userSignupViewModel : UserSignupViewModel) ->
      printfn "%A" userSignupViewModel
      return! Redirection.FOUND "/signup" ctx
    | Choice2Of2 err ->
      let viewModel = {emptyUserSignupViewModel with Error = Some err}
      return! page "user/signup.liquid" viewModel ctx
  }
  // ...
```

As the `bindEmptyForm` function returns a `generic` type as its first option, we need to specify the type to enable the model binding explicitly. 

If the model binding succeeds, we just print the view model and redirects the user to the signup page as we did in the previous section.

If it fails, we modify the viewModel with the error being returned and render the signup page again.

When we rerun the program and do the form post again, we will get the following output.

```bash
{Username = "demystifyfp";
 Email = "demystifyfp@gmail.com";
 Password = "secret";
 Error = None;}
```

## Transforming View Model To Domain Model

Now we have the server side representation of the submitted details in the form of `UserSignupViewModel`. The next step is validating this view model against a set of constraints before persisting them in a data store. 

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
> forge paket add Chessie
```
*FsTweet.Web/paket.references*
```
...
Chessie
```

```bash
> forge install
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

We came a long way in this blog post. We started with rendering the signup form, and then we did the model binding using the `Suave.Experimental` library. 

Finally, we learned how to do validation and transform view model to a domain model using the Railway Programming technique with the help of the `Chessie` library.

The source code is available in [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.3)