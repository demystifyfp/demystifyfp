---
title: "Handling Login Request"
date: 2017-09-28T07:37:43+05:30
tags: [Chessie, rop, fsharp, SQLProvider, suave]
---

Hi there!

In the [previous blog post]({{< relref "adding-login.md" >}}), we have validated the login request from the user and mapped it to a domain type `LoginRequest`. The next step is authenticating the user to login to the application. 

It involves following steps. 

1. Finding the user with the given username
2. If the user exists, matching the provided password with the user's corresponding password hash. 
3. If the password matches, creating a user session (cookie) and redirecting the user to the homepage. 
4. Handling the errors while performing the above three steps. 

We are going to implement all the above steps except creating a user session in this blog post. 

Let's get started!


## Finding The User By Username

To find the user by his/her username, we first need to have domain type representing `User`. 

So, as a first step, let's create a record type for representing the `User`. 

```fsharp
// FsTweet.Web/User.fs
// ...
type User = {
  UserId : UserId
  Username : Username
  PasswordHash : PasswordHash
}
```

The `EmailAddress` of the user will be either verified or not verified. 

```fsharp
// FsTweet.Web/User.fs
// ...
type UserEmailAddress = 
| Verified of EmailAddress
| NotVerified of EmailAddress
```

To retrieve the string representation of the `EmailAddress` in both the cases, let's add a member property `Value`

```fsharp
type UserEmailAddress = 
// ...
with member this.Value =
      match this with
      | Verified e | NotVerified e -> e.Value
```

Then add `EmailAddress` field in the `User` record of this type

```fsharp
type User = {
  // ...
  EmailAddress : UserEmailAddress
}
```

Now we have a domain type to represent the user. The next step is defining a type for the function which retireves `User` by `Username`

```fsharp
// FsTweet.Web/User.fs
// ...
type FindUser = 
  Username -> AsyncResult<User option, System.Exception>
```

As the user may not exist for a given `Username`, we are using `User option`. 

Great! Let's define the persistence layer which implements this. 

Create a new module `Persistence` in the *User.fs* and add a `findUser` function

```fsharp
// FsTweet.Web/User.fs
// ...
module Persistence =
  open Database

  let findUser (getDataCtx : GetDataContext) (username : Username) = asyncTrial {
    // TODO
  }
```

Finding the user by `Username` is very similar to what [we did in](https://github.com/demystifyfp/FsTweet/blob/v0.12/src/FsTweet.Web/UserSignup.fs#L141-L147) the `verifyUser` function. There we found the user by verification code, and here we need to find by `Username`. 

```fsharp
module Persistence =
  // ...
  open FSharp.Data.Sql
  open Chessie

  let findUser ... = asyncTrial {
    let ctx = getDataCtx()
    let! userToFind = 
      query {
        for u in ctx.Public.Users do
          where (u.Username = username.Value)
      } |> Seq.tryHeadAsync |> AR.catch
    // TODO
  }
```
If the user didn't exist, we need to return `None`

```fsharp
let findUser ... = asyncTrial {
  // ...
  match userToFind with
  | None -> return None
  | Some user -> 
    // TODO 
}
```

If the user exists, we need to transform that user that we retrieved to its corresponding `User` domain model. To do it, we need a function that has the signature

```fsharp
DataContext.``public.UsersEntity`` -> AsyncResult<User, System.Exception>
```

Let's create this function

```fsharp
// FsTweet.Web/User.fs
// ...
module Persistence =
  // ...
  let mapUser (user : DataContext.``public.UsersEntity``) = 
    // TODO
  // ...
```

We already have `TryCreate` functions in `Username` and `EmailAddress` to create themselves from the string type. 

But we didn't have one for the `PasswordHash`. As we need it in this `mapUser` function, let's define it.

```fsharp
// FsTweet.Web/User.fs
module User 
  // ...
  type PasswordHash = ...
  // ...

  // string -> Result<PasswordHash, string>
  static member TryCreate passwordHash =
    try 
      BCrypt.InterrogateHash passwordHash |> ignore
      PasswordHash passwordHash |> ok
    with
    | _ -> fail "Invalid Password Hash"
```

The `InterrogateHash` function from the [BCrypt](https://github.com/BcryptNet/bcrypt.net) library takes a hash and outputs its components if it is valid. In case of invalid hash, it throws an exception. 

Now, coming back to the `mapUser` that we just started, let's map the username, the password hash, and the email address of the user

```fsharp
// FsTweet.Web/User.fs
// ...
module Persistence =
  let mapUser (user : DataContext.``public.UsersEntity``) = 
    let userResult = trial {
      let! username = Username.TryCreate user.Username
      let! passwordHash = PasswordHash.TryCreate user.PasswordHash
      let! email = EmailAddress.TryCreate user.Email
      // TODO
    }
    // TODO
  // ...
```

Then we need to check whether the user email address is verified or not and create the corresponding `UserEmailAddress` type. 

```fsharp
let mapUser ... = 
  let userResult = trial {
    // ...
    let userEmail =
      match user.IsEmailVerified with
      | true -> Verified email
      | _ -> NotVerified email
    // TODO
  }
  // TODO
```

Now we have all the individual fields of the `User` record; we can return it from `trial` computation expression

```fsharp
let mapUser ... = 
  let userResult = trial {
    // ...
    return {
      UserId = UserId user.Id
      Username = username
      PasswordHash = passwordHash
      Email = userEmail
    } 
  }
  // TODO
```

The `userResult` is of type `Result<User, string>` with the failure (of `string` type) side representing the validation error that may occur while mapping the user representation from the database to the domain model. It also means that data that we retrieved is not consistent, and hence we need to treat this failure as Exception. 

```fsharp
// DataContext.``public.UsersEntity`` -> AsyncResult<User, System.Exception>
let mapUser ... = 
  let userResult = trial { ... }
  userResult // Result<User, string>
  |> mapFailure System.Exception // Result<User, Exception>
  |> Async.singleton // Async<Result<User, Exception>>
  |> AR // AsyncResult<User, Exception>
```

We mapped the failure side of `userResult` to `System.Exception` and transformed `Result` to `AsyncResult`.

With the help of this `mapUser` function, we can now return the `User` domain type from the `findUser` function if the user exists for the given username

```fsharp
// FsTweet.Web/User.fs
// ...
module Persistence =
  // ...
  let mapUser ... = ...

  let findUser ... = asyncTrial {
    match userToFind with
    // ...
    | Some user -> 
      let! user = mapUser user
      return Some user
  }
```

## Implementing The Login Function

The next step after finding the user is, verifying his/her password hash with the password provided. 

To do it, we need to have a function in the `PasswordHash` type. 


```fsharp
// FsTweet.Web/User.fs
// ...
type PasswordHash = ...
  // ...

  // Password -> PasswordHash -> bool
  static member VerifyPassword 
                  (password : Password) (passwordHash : PasswordHash) =
    BCrypt.Verify(password.Value, passwordHash.Value)

// ...
```

The `Verify` function from the *BCrypt* library takes care of verifying the password with the hash and returns `true` if there is a match and `false` otherwise. 


Now we have the required functions for implementing the login function. 

Let's start our implementation of the login function by defining a type for it.

```fsharp
// FsTweet.Web/Auth.fs
module Domain = 
  // ...
  type Login = 
    FindUser -> LoginRequest -> AsyncResult<User, LoginError>
```

The `LoginError` type is not defined yet. So, let's define it

```fsharp
module Domain = 
  // ...
  
  type LoginError =
  | UsernameNotFound
  | EmailNotVerified
  | PasswordMisMatch
  | Error of System.Exception

  type Login = ...
```

The `LoginError` discriminated union elegantly represents all the possible errors that may happen while performing the login operation. 

The implementation of the `login` function starts with finding the user and mapping its failure to the `Error` union case if there is any error.

```fsharp
module Domain =
  // ...
  open Chessie

  let login (findUser : FindUser) (req : LoginRequest) = asyncTrial {
    let! userToFind = 
      findUser req.Username |> AR.mapFailure Error
    // TODO
  }
```

If the user to find didn't exist, we need to return the `UsernameNotFound` error.

```fsharp
let login ... = asyncTrial {
  // ...
  match userToFind with
  | None -> 
    return UsernameNotFound
  // TODO
}
```

Though it appears correct, there is an error in above implementation. 

The function signature of the login function currently is

```fsharp
FindUser -> LoginRequest -> AsyncResult<LoginError, LoginError>
```

Let's focus our attention to the return type `AsyncResult<LoginError, LoginError>`. 

The F# Compiler infers the failure part of the `AsyncResult` as `LoginError` from the below expression

```fsharp
asyncTrial {
  let! userToFind = 
    findUser req.Username // AsyncResult<User, Exception>
    |> AR.mapFailure Error // AsyncResult<User, LoginError>
}
```

when we return the `UsernameNotFound` union case, F# Compiler infers it as the success side of the `AsyncResult`.

```fsharp
asyncTrial {
  return UsernameNotFound // LoginError
}
```

It is because the `return` keyword behind the scenes calls the `Return` function of the `AsyncTrialBuilder` type and this `Return` function populates the success side of the `AsyncResult`. 

> Here is the code snippet of the `Return` function copied from the [Chessie](https://github.com/fsprojects/Chessie/blob/master/src/Chessie/ErrorHandling.fs) library for your reference
```fsharp
type AsyncTrialBuilder() = 
  member __.Return value : AsyncResult<'a, 'b> = 
    value
    |> ok
    |> Async.singleton
    |> AR
```

To fix this type mismatch we need to do what the `Return` function does but for the failure side. 

```fsharp
let login ... = asyncTrial {
  // ...
  match userToFind with
  | None -> 
    let! result =
      UsernameNotFound // LoginError
      |> fail // Result<'a, LoginError>
      |> Async.singleton // Async<Result<'a, LoginError>>
      |> AR // AsyncResult<'a, LoginError>
    return result
  // TODO
}
```

The `let!` expression followed by `return` can be replaced with `return!` which does the both.

```fsharp
let login ... = asyncTrial {
  // ...
  match userToFind with
  | None -> 
    return! UsernameNotFound 
      |> fail 
      |> Async.singleton 
      |> AR 
  // TODO
}
```

The next thing that we have to do in the login function, checking whether the user's email is verified or not. If it is not verified, we return the `EmailNotVerified` error.

```fsharp
let login ... = asyncTrial {
  // ...
  match userToFind with
  // ...
  | Some user ->
    match user.EmailAddress with
    | NotVerified _ -> 
      return! 
        EmailNotVerified
        |> fail 
        |> Async.singleton 
        |> AR 
    // TODO
}
```

If the user's email address is verified, then we need to verify his/her password and return `PasswordMisMatch` error if there is a mismatch.

```fsharp
let login ... = asyncTrial {
  // ...
  match userToFind with
  // ...
  | Some user ->
    match user.EmailAddress with
    // ...
    | Verified _ -> 
      let isMatchingPassword =
        PasswordHash.VerifyPassword req.Password user.PasswordHash
      match isMatchingPassword with
      | false -> 
        return! 
          PasswordMisMatch
          |> fail 
          |> Async.singleton 
          |> AR 
      // TODO
}
```

I am sure you would be thinking about refactoring the following piece of code which is getting repeated in all the three places when we return a failure from the `asyncTrial` computation expression.

```fsharp
|> fail 
|> Async.singleton 
|> AR 
```

To refactor it, let's have a look at the signature of the `fail` function from the *Chessie* library.

```fsharp
'b -> Result<'a, 'b>
```
The three lines of code that was getting repeated do the same transformation but on the `AsyncResult` instead of `Result`

```fsharp
'b -> AsyncResult<'a, 'b>
```

So, let's create `fail` function in the `AR` module which implements this logic

```fsharp
// FsTweet.Web/Chessie.fs
// ...
module AR =
  // ...
  let fail x =
    x // 'b
    |> fail // Result<'a, 'b>
    |> Async.singleton // Async<Result<'a, 'b>>
    |> AR // AsyncResult<'a, 'b>
```

With the help of this new function, we can simplify the `login` function as below

```diff

- return! 
-   UsernameNotFound 
-   |> fail 
-   |> Async.singleton 
-   |> AR 
+ return! AR.fail UsernameNotFound
...
-   return! 
-     EmailNotVerified 
-     |> fail 
-     |> Async.singleton 
-     |> AR 
+   return! AR.fail EmailNotVerified
...
-    return! 
-      PasswordMisMatch
-      |> fail 
-      |> Async.singleton 
-      |> AR 
+    return! AR.fail PasswordMisMatch 
```

Coming back to the `login` function, if the password does match, we just need to return the `User`. 

```fsharp
let login ... = asyncTrial {
  // ...
  match userToFind with
  // ...
  | Some user ->
    match user.EmailAddress with
    // ...
    | Verified _ -> 
      let isMatchingPassword = ...
      match isMatchingPassword with
      // ...
      | true -> return User
}
```

The presentation layer can take this value of `User` type and send it to the end user either as an [HTTP Cookie](https://en.wikipedia.org/wiki/HTTP_cookie) or a [JWT](https://en.wikipedia.org/wiki/JSON_Web_Token). 


## The Presentation Layer For Transforming Login Response

If there is any error while doing login, we need to populate the login view model with the corresponding error message and rerender the login page.

```fsharp
// FsTweet.Web/Auth.fs
// ...
module Suave =
  // ...
  
  // LoginViewModel -> LoginError -> WebPart
  let onLoginFailure viewModel loginError =
    match loginError with
    | PasswordMisMatch ->
       let vm = 
        {viewModel with Error = Some "password didn't match"}
       renderLoginPage vm
    | EmailNotVerified -> 
       let vm = 
        {viewModel with Error = Some "email not verified"}
       renderLoginPage vm
    | UsernameNotFound -> 
       let vm = 
        {viewModel with Error = Some "invalid username"}
       renderLoginPage vm
    | Error ex -> 
      printfn "%A" ex
      let vm = 
        {viewModel with Error = Some "something went wrong"}
      renderLoginPage vm
  // ...
```

In case of login success, we return the username as a response. In the next blog post, we will be revisiting this piece of code. 

```fsharp
// FsTweet.Web/Auth.fs
// ...
module Suave =
  // ...
  open User
  // ...
  // User -> WebPart
  let onLoginSuccess (user : User) = 
    Successful.OK user.Username.Value
  // ...
```

With the help of these two function, we can transform the `Result<User,LoginError>` to `WebPart` using the either function

```fsharp
module Suave =
  // ...

  // LoginViewModel -> Result<User,LoginError> -> WebPart
  let handleLoginResult viewModel loginResult = 
    either onLoginSuccess (onLoginFailure viewModel) loginResult

  // ...
```

The next piece of work is transforming the async version of login result

```fsharp
module Suave =
  // ...

  // LoginViewModel -> AsyncResult<User,LoginError> -> Async<WebPart>
  let handleLoginAsyncResult viewModel aLoginResult = 
    aLoginResult
    |> Async.ofAsyncResult
    |> Async.map (handleLoginResult viewModel)
```

The final step is wiring the domain, persistence and the presentation layers associated with the login. 

First, pass the `getDataCtx` function from the `main` function to the `webpart` function

```diff
// FsTweet.Web/FsTweet.Web.fs
-      Auth.Suave.webpart ()
+      Auth.Suave.webpart getDataCtx
```

Then in the `webpart` function in the add getDataCtx as its parameter and use it to partially apply in the `findUser` function

```diff
-  let webpart () =
+  let webpart getDataCtx =
+    let findUser = Persistence.findUser getDataCtx
```

Followed up with passing the partially applied `findUser` function to the `handlerUserLogin` function and remove the `TODO` placeholder in the `handlerUserLogin` function.

```diff
-  let handleUserLogin ctx = async {
+  let handleUserLogin findUser ctx = async {
...
-        return! Successful.OK "TODO" ctx
...
-      POST >=> handleUserLogin
+      POST >=> handleUserLogin findUser
```

Finally in the `handleUserLogin` function, if the login request is valid, call the `login` function with the provided `findUser` function and the validated login request and transform the result of the login function with to `WebPart` using the `handleLoginAsyncResult` defined earlier.

```fsharp
let handleUserLogin findUser ctx = async {
  // ...
    let result = ...
    match result with
    | Success req -> 
      let aLoginResult = login findUser req 
      let! webpart = 
        handleLoginAsyncResult vm aLoginResult
      return! webpart ctx
  // ...
}
```

That's it!

## Summary

We covered a lot of ground in this blog post. We started with finding the user by username and then we moved to implement the login function. And finally, we transformed the result of the login function to the corresponding webparts. 

The source code of this blog post is available [here](https://github.com/demystifyfp/FsTweet/releases/tag/v0.13).