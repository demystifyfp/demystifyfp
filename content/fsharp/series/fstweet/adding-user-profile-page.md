---
title: "Adding User Profile Page"
date: 2017-10-24T20:18:33+05:30
draft: true
tags : [suave, DotLiquid, fsharp, chessie, getstream]
---

Hi there!

Welcome back to the eighteenth part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series. 

We are on the verge of completing the initial version of FsTweet. To say FsTweet as a Twitter clone, we should be able to follow other users and view their tweets in our wall page. To do it, we first need to have a user profile page where we can go and follow the user. 

In this blog post, we are going to create the user profile page. 

## The User Profile Page

We are going to consider the username of the user as the twitter handle in the user profile page and it will be served in the url `/{username}`. 

The user profile page will be having the following UI Components.

1. A Gravatar image of the user along with the username. 

2. List of tweets tweeted by the given user 

3. List of users that he/she following

4. List of his/her followers. 

> The components three and four will be addressed in the later blog posts. 

In addition to it, we also have to address the following three sceanrios in the profile page.   

1. Anyone should be able to view a profile of anybody else without logging in to the application. The anonymous user can only view the page. 
![User Profile Guest](/img/fsharp/series/fstweet/user_profile_guest.png) 

2. If a logged in user visits an another user profile page, he/she should be able to follow him/her
![User Profile Other](/img/fsharp/series/fstweet/user_profile_other.png) 

3. If a logged in user visits his/her profile page, there should not be any provision to follow himself/herself. 
![User Profile Self](/img/fsharp/series/fstweet/user_profile_self.png) 

Let's dive in and implement the user profile page. 

To start with we are going to implement the first UI Component, the gravatar image along with the username and we will also be addressing the above three scenarios.

### User Profile Liquid Template
 
Let's get started by creating the a new liquid template *profile.liqud* for the user profile page. 

```bash
> touch src/FsTweet.Web/views/user/profile.liquid
```

Then update it as below

```html
{% extends "master_page.liquid" %}

{% block head %}
  <title> {{model.Username}} - FsTweet </title>
{% endblock %}

{% block content %}
<div>
  <img src="{{model.GravatarUrl}}" alt="" class="gravatar" />
  <p class="gravatar_name">@{{model.Username}}</p>
  {% if model.IsLoggedIn %}
    {% unless model.IsSelf %}
      <a href="#" id="follow" data-username="{{model.username}}">Follow</a>
    {% endunless %}
    <a href="/logout">Logout</a>
  {% endif %}
</div>
{% endblock %}
```

> Styles are ignored for brevity.

We are using two boolean properties `IsLoggedIn` and `IsSelf` to show/hide the UI elements that we saw above. 

The next step is adding the server side logic to render this template. 

## Rendering User Profile Template

Create a new fsharp file *UserProfile.fs* and move it above *FsTweet.Web.fs*

```bash
> forge newFs web -n src/FsTweet.Web/UserProfile

> repeat 2 forge moveUp web -n src/FsTweet.Web/UserProfile.fs
```

As a first step, let's define a domain model for user profile 

```fsharp
// src/FsTweet.Web/UserProfile.fs
namespace UserProfile

module Domain = 
  open User
  
  type UserProfile = {
    User : User
    GravatarUrl : string
    IsSelf : bool
  }
```

Then add the `gravatarUrl` function that creates the gravatar URL from the user's email address.

```fsharp
module Domain =
  // ...
  open System.Security.Cryptography
  
  // ...
  
  let gravatarUrl (emailAddress : UserEmailAddress) =
    use md5 = MD5.Create()
    emailAddress.Value 
    |> System.Text.Encoding.Default.GetBytes
    |> md5.ComputeHash
    |> Array.map (fun b -> b.ToString("x2"))
    |> String.concat ""
    |> sprintf "http://www.gravatar.com/avatar/%s?s=200"
```

> The `gravatarUrl` function uses [this logic](https://en.gravatar.com/site/implement/images/) to generate the URL.

To simplify the creating a value of `UserProfile`, let's add a function `newUserProfile` to create `UserProfile` from `User`. 

```fsharp
// User -> UserProfile
let newProfile user = { 
  User = user
  GravatarUrl = gravatarUrl user.EmailAddress
  IsSelf = false
}
```

Then add the `findUserProfile` function, which finds the user profile by username

```fsharp
module Domain =
  // ...
  open Chessie.ErrorHandling
  
  // ...

  type FindUserProfile = 
    Username -> AsyncResult<UserProfile option, Exception>

  // FindUser -> Username -> AsyncResult<UserProfile option, Exception>
  let findUserProfile (findUser : FindUser) username = asyncTrial {
    let! userMayBe = findUser username
    return Option.map newProfile userMayBe
  }
```

We are making use of the `findUser` function that we created while [handling user login request]({{< relref "handling-login-request.md#finding-the-user-by-username" >}})

The next step is using this function to get the `UserProfile` if the user didn't login or the logged in user is looking to find an another user's profile.

If the `Username` of the logged in user matches with the `Username` that we are looking to find, we don't need call the `findUserProfile`. Instead we can use the `newProfile` function to get the profile from the `User` and modify its `IsSelf` property to `true`.

```fsharp

type HandleUserProfile = 
    Username -> User option 
      -> AsyncResult<UserProfile option, Exception>
      
// FindUserProfile -> Username -> User option 
//    -> AsyncResult<UserProfile option, Exception>
let handleUserProfile 
      findUserProfile (username : Username) loggedInUserMayBe  = asyncTrial {

    match loggedInUserMayBe with
    | None -> 
      return! findUserProfile username
    | Some (user : User) -> 
      if user.Username = username then
        let userProfile =
          {newProfile user with IsSelf = true}
        return Some userProfile
      else  
        return! findUserProfile username

  }
```

Now we have the domain logic for finding user profile in place and let's turn our attention to the presentation logic!

As we did for other pages, create a new module `Suave` and define a view model for the profile page. 

```fsharp
// src/FsTweet.Web/UserProfile.fs
namespace UserProfile
//...

module Suave =
  type UserProfileViewModel = {
    Username : string
    GravatarUrl : string
    IsLoggedIn : bool
    IsSelf : bool
  }
```

Then add a function `newUserProfileViewModel` which creates `UserProfileViewModel` from `UserProfile`.

```fsharp
module Suave =
  open Domain
  // ...

  // UserProfile -> UserProfileViewModel
  let newUserProfileViewModel (userProfile : UserProfile) = {
    Username = userProfile.User.Username.Value
    GravatarUrl = userProfile.GravatarUrl
    IsLoggedIn = false
    IsSelf = userProfile.IsSelf
  }
```

The next step is transforming the return type (`AsyncResult<UserProfile option, Exception>`) of the `handleUserProfile` to `Async<WebPart>`. To do it we first need to define what we will be doing on success and on failure.


```fsharp
// src/FsTweet.Web/UserProfile.fs
// ...
module Suave =
  // ...
  open Suave.DotLiquid
  open Chessie
  open System
  // ...

  let renderUserProfilePage (vm : UserProfileViewModel) = 
    page "user/profile.liquid" vm
  let renderProfileNotFound =
    page "not_found.liquid" "user not found"

  // bool -> UserProfile option -> WebPart
  let onHandleUserProfileSuccess isLoggedIn userProfileMayBe = 
    match userProfileMayBe with
    | Some (userProfile : UserProfile) -> 
      let vm = { newUserProfileViewModel userProfile with
                  IsLoggedIn = isLoggedIn }
      renderUserProfilePage vm
    | None -> 
      renderProfileNotFound

  // System.Exception -> WebPart
  let onHandleUserProfileFailure (ex : Exception) =
    printfn "%A" ex
    page "server_error.liquid" "something went wrong"
```

Then wire these functions up with the actual request handler.

```fsharp
// HandleUserProfile -> string -> User option -> WebPart
let renderUserProfile handleUserProfile username loggedInUser ctx = async {
  match Username.TryCreate username with
  | Success validatedUsername -> 
    let isLoggedIn = 
      Option.isSome loggedInUser
    let onSuccess = 
      onHandleUserProfileSuccess isLoggedIn
    let! webpart = 
      handleUserProfile validatedUsername loggedInUser
      |> AR.either onSuccess onHandleUserProfileFailure
    return! webpart ctx
  | Failure _ -> 
    return! renderProfileNotFound ctx
}
```

The final step is exposing this function and adding a HTTP route.

```fsharp
// src/FsTweet.Web/UserProfile.fs
// ...
module Suave =
  // ...
  open Database
  open Suave.Filters
  open Auth.Suave
  // ...

  let webpart (getDataCtx : GetDataContext) = 
    let findUserProfile = findUserProfile (Persistence.findUser getDataCtx)
    let handleUserProfile = handleUserProfile findUserProfile
    let renderUserProfile = renderUserProfile handleUserProfile
    pathScan "/%s" (fun username -> mayRequiresAuth (renderUserProfile username))
```


```diff
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  // ...
  let app = 
    choose [
      // ...
+     UserProfile.Suave.webPart getDataCtx
    ]
  // ...
```

To test drive this new feature, run the application and view the user profile as an anonymous user. Then singup some new users (make sure you verify their email id) and then login and view other users profile. 

We haven't added logout yet. So, to login as a new user either clear cookies in the brower or restart your browser. 


### Adding User Feed