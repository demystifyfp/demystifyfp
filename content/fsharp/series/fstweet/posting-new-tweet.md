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
    <div id="wall" />
  </div>
</div>
```

> Styles are ignore for brevity. 

Now, if you run the applications, you will be able to see the updated wall page after login.

![user wall v0.1](/img/fsharp/series/fstweet/wall_v0.png)
