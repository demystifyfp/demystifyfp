---
title: "Handling User signup Form"
date: 2017-08-19T16:37:26+05:30
tags: [suave, forge,fsharp]
---

In the [last blog post]({{< relref "static-assets.md" >}}), we added a cool landing page for *FsTweet* to increase the user signups. But the signup form and its backend are not ready yet!

In this fourth part, we will be extending *FsTweet* to serve the signup page and implement its backend scaffolding

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
> forge paket add Suave.Experimental -p src/FsTweet.Web/FsTweet.Web.fsproj
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

## Summary

In this blog post, We started with rendering the signup form, and then we learned how to do view model binding using the `Suave.Experimental` library. 

The source code is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.3)