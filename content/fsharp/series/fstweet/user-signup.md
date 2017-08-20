---
title: "User Signup"
date: 2017-08-19T16:37:26+05:30
draft: true
---


```bash
forge new file -t fs \
  -p src/FsTweet.Web/FsTweet.Web.fsproj \
  -n src/FsTweet.Web/UserSignup
```

```toml
# ...
  web='-p src/FsTweet.Web/FsTweet.Web.fsproj'
  newFs='new file -t fs'
```

```bash
forge newFs web -n foo.fs
```

```bash
forge move file -p src/FsTweet.Web/FsTweet.Web.fsproj \
  -n src/FsTweet.Web/UserSignup.fs -u
```

```toml
# ...
  moveUp='move file -u'
```

```bash
forge moveUp web -n foo.fs
```

```bash
forge {operation-alias} {project-alias} {other-arguments}
```

```fsharp
// FsTweet.Web/UserSignup.fs
namespace UserSignup

module Suave =

  open Suave.Filters
  open Suave.Operators
  open Suave.DotLiquid

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


```fsharp
// FsTweet.Web/UserSignup.fs
open Suave 
// ...
module Suave =
  // ...
  let handleUserSignup ctx = async {
    printfn "%A" ctx.request.form
    return! Redirection.FOUND "/signup" ctx
  }

  let webPart () =
    path "/signup" 
      >=> choose [
        GET >=> page "user/signup.liquid" emptyUserSignupViewModel
        POST >=> handleUserSignup
      ]
```

```bash
[("Email", Some "demystifyfp@gmail.com"); ("Username", Some "demystifyfp");
 ("Password", Some "secret"); ("Error", Some "")]
```

```bash
> forge paket add Suave.Experimental
```

```
...
Suave.Experimental
```

```bash
> forge install
```

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
```

```bash
{Username = "demystifyfp";
 Email = "demystifyfp@gmail.com";
 Password = "secret";
 Error = "";}
```

```bash
> forge paket add Chessie
```

```
...
Chessie
```

```bash
> forge install
```

```fsharp
module Domain =
  open Chessie.ErrorHandling

  type Username = private Username of string with
    static member TryCreate (username : string) =
      match username with
      | null | ""  -> fail "Username should not be empty"
      | x when x.Length > 12 -> fail "Username should not be more than 12 characters"
      | x -> Username x |> ok
```

```fsharp
module Domain =
  // ...
  type Username = private Username of string with
    // ...
    member this.Value = 
      let (Username username) = this
      username
```

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

  type Password = private Password of string with 
    member this.Value =
      let (Password password) = this
      password
    static member TryCreate (password : string) =
      match password with
      | null | ""  -> fail "Password should not be empty"
      | x when x.Length < 4 || x.Length > 8 -> fail "Password should contain only 4-8 characters"
      | x -> Password x |> ok
```

```fsharp
module Domain =
  type SignupUser = {
    Username : Username
    Password : Password
    EmailAddress : EmailAddress
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
        SignupUser.TryCreate (vm.Username, vm.Password, vm.Email)
      let onSuccess (signupUser, _) =
        printfn "%A" signupUser
        Redirection.FOUND "/signup" ctx
      let onFailure msgs =
        let viewModel = {vm with Error = Some (List.head msgs)}
        page "user/signup.liquid" viewModel ctx
      return! either onSuccess onFailure result
    // ...
  }
  // ...
```

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

```bash
{Username = Username "demystifyfp";
 Password = Password "secret";
 EmailAddress = EmailAddress "demystifyfp@gmail.com";}
```