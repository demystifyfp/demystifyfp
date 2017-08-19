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

