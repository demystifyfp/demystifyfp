---
title: "Posting New Tweet"
date: 2017-10-09T19:51:48+05:30
draft: true
---

Hi there!

In this sixteenth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series, we are going to implement core feature of Twitter, posting a tweet. 

Let's dive in!

## Rendering The Wall Page

In the [previous blog post]({{< relref "creating-user-session-and-authenticating-user.md#rending-the-wall-page-with-a-placeholder" >}}), we have left the user's wall page with a placeholder. So, As a first step, let's replace this with an actual page to enable the user to post tweets. 

This initial version of user's wall page, will display a `textarea` to capture the tweet being posted and placeholder to display the list of tweets in the wall. 

It will also greet the user with a message *Hi {username}* along with links to go his/her profile page and logout. We will adding implementations for profile and logout in the later posts. 

In the *Wall.fs*, define a new type `WallViewModel` 

```fsharp
namespace Wall

module Suave =
  // ...
  open Suave.DotLiquid

  type WallViewModel = {
    Username :  string
  }
  // ...
```
and render the `user/wall.liquid` template with this view model

```diff
  let renderWall (user : User) ctx = async {
-    return! Successful.OK user.Username.Value ctx
+    let vm = {Username = user.Username.Value }
+    return! page "user/wall.liquid" vm ctx
  }
```

Create a new dotliqud template *wall.liquid* in the *views/user* directly and update it as below

```html
{% extends "master_page.liquid" %}

{% block head %}
  <title> {{model.Username}}  </title>
{% endblock %}

{% block content %}
<div>
  <div>
    <p class="username">Hi {{model.Username}}</p>
    <a href="/{{model.Username}}">My Profile</a>
    <a href="/logout">Logout</a>
  </div>
  <div>
    <div>
      <form>
        <textarea id="tweet"></textarea>     
        <button> Tweet </button>
      </form>
    </div>
  </div>
</div>
```

> Styles are ignore for brevity. 

Now, if you run the application, you will be able to see the updated wall page after login. 

![user wall v0.1](/img/fsharp/series/fstweet/wall_v0.png)

## Full Page Refresh

In the both signup and login pages, we are doing full page refresh when the user submitted the form. But in the wall page, doing a full page refresh while posting a new tweet is not a good user experience.

The better option would be having a javascript code on the wall page, doing a [AJAX](https://developer.mozilla.org/en-US/docs/AJAX/Getting_Started) POST request with a JSON payload when the user click the `Tweet` button.

That means we need to have a corresponding end point on the server responding to this request!

## Revisting The requiresAuth function

Before creating a HTTP endpoint to handle new tweet, let's have a revisit to our authentication implementation to add support for JSON HTTP endpoints.

```fsharp
let requiresAuth fSuccess =
authenticate CookieLife.Session false
  (fun _ -> Choice2Of2 redirectToLoginPage)
  (fun _ -> Choice2Of2 redirectToLoginPage)
  (userSession redirectToLoginPage fSuccess)
```

Currently, we are redirecting the user to login page, if the user didn't have access. But this approach will not work out for AJAX requests, as it doesn't full page refresh. 

What we want is a HTTP response from the server with a status code `401 Unauthorized` and a JSON body. 

To enable this, let's refactor the `requiresAuth` as below

```fsharp
// FsTweet.Web/Auth.fs
// ...
module Suave = 
  // ...
  // WebPart -> WebPart -> WebPart
  let onAuthenticate fSuccess fFailure =
    authenticate CookieLife.Session false
      (fun _ -> Choice2Of2 fFailure)
      (fun _ -> Choice2Of2 fFailure)
      (userSession fFailure fSuccess)

  let requiresAuth fSuccess =
    onAuthenticate fSuccess redirectToLoginPage
  // ...
```

We have extracted the `requiresAuth` function into a new function `onAuthenticate` and added a new parameter `fFailure` to parameterize what to do when authentication fails.

Then in the `requiresAuth` function, we are calling the `onAuthenticate` function with the `redirectToLoginPage` webpart for authentication failures. 

Now with the help of the new function `onAuthenticate`, we can send an unauthorized response in case of an authentication failure using a new function `requiresAuth2` 

```fsharp
let requiresAuth2 fSuccess =
  onAuthenticate fSuccess (RequestErrors.UNAUTHORIZED "???")
```

The `RequestErrors.UNAUTHORIZED` function, takes a `string` to populate the request body and return a `WebPart`. To send JSON string as a response body we need to do few more work!

### Sending JSON Response

To send a JSON response, there is no out of the box direct in Suave as the library doesn't want to have a dependency on any other external libaries other than [FSharp.Core](https://www.nuget.org/packages/FSharp.Core).

However, we can do it with ease with the basic HTTP abstractions provided by Suave.

We just need to serialize the return value to the JSON string representation and send the response with the header `Content-Type` populated with `application/json` value. 

To do the JSON serialization and deserialization (which we will be doing later in this blog post), let's add a [Chiron](https://xyncro.tech/chiron/) Nuget Package to the *FsTweet.Web* project.

```bash
> forge paket add Chiron -p src/FsTweet.Web/FsTweet.Web.fsproj
```

> Chiron is a JSON library for F#. It can handle all of the usual things you’d want to do with JSON, (parsing and formatting, serialization and deserialization). 

> Chiron works rather differently to most .NET JSON libraries with which you might be familiar, using neither reflection nor annotation, but instead uses a simple functional style to be very explicit about the relationship of types to JSON. This gives a lot of power and flexibility - *Chrion Documentation*


Then create a new fsharp file *Json.fs* to put all the Json related functionalities. 

```bash
> forge newFs web -n src/FsTweet.Web/Json
```

And move this file above *User.fs*

```bash
> repeat 6 forge moveUp web -n src/FsTweet.Web/Json.fs
```

To send an error message to the front-end, we are going to use the following JSON structure

```json
{
  "msg" : "..."
}
```

Let's add a function, `unauthorized`, in the *Json.fs* file that returns a WebPart having a `401 Unauthorized` response with a JSON body.

```fsharp
// FsTweet.Web/Json.fs

[<RequireQualifiedAccess>]
module JSON 

open Suave
open Suave.Operators
open Chiron

// WebPart
let unauthorized =
  ["msg", String "login required"] // (string * Json) list
  |> Map.ofList // Map<string,Json>
  |> Object // Json
  |> Json.format // string
  |> RequestErrors.UNAUTHORIZED // Webpart
  >=> Writers.addHeader 
        "Content-type" "application/json; charset=utf-8"

```

The `String` and `Object` are the union cases of the `Json` discriminated type in the Chiron library.  

The `Json.format` function creates the `string` representation of the underlying `Json` type and then we pass it to the `RequestErrors.UNAUTHORIZED` function to populate the response body with this JSON formatted string and finally we set the `Content-Type` header. 

Now we can rewrite the `requiresAuth2` function as below

```diff
let requiresAuth2 fSuccess =
-  onAuthenticate fSuccess (RequestErrors.UNAUTHORIZED "???")
+  onAuthenticate fSuccess JSON.unauthorized
```

With this we are done with the authentication side of HTTP endpoints serving JSON response. 

## Handling New Tweet POST Request