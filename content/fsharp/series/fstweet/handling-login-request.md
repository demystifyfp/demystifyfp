---
title: "Handling Login Request"
date: 2017-09-28T07:37:43+05:30
draft: true
---

Hi there!

In the previous blog post we have validated the login request from the user and mapped it to a domain type `LoginRequest`. 

The next step is authenticating the user to login to the application. This involves following steps. 

1. Finding the user with the given username
2. If the user exists, matching the provided password with the user's corresponding password hash. 
3. If the password matches, creating a user session (cookie) and redirecting the user to the home page. 
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

The `EmailAddress` of the user, will be either verified or not verified. 

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

Then add a `EmailAddress` field in the `User` record of this type

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

As the user may not exists for a given `Username` we are using `User option`. 

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

Finding the user by `Username` is very similar to what [we did in](https://github.com/demystifyfp/FsTweet/blob/v0.12/src/FsTweet.Web/UserSignup.fs#L141-L147) the `verifyUser` function. There we found the user by verification code and here we need find by `Username`. So, let's dive in directly.

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

If the user exists, we need to transform that user that we retireved to its corresponding `User` domain model. In other words we need to define function that has the signature

```fsharp
DataContext.``public.UsersEntity`` -> AsyncResult<User, System.Exception>
```

Let's create this function

```fsharp
// FsTweet.Web/User.fs
// ...
module Persistence =
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

The `InterrogateHash` function from the [BCrypt](https://github.com/BcryptNet/bcrypt.net) library, takes a hash and outputs its component parts if it is valid. In case of invalid hash it throws an exception. 

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

Then we need to check wheather the user email address is verified or not and create the corresponding `UserEmailAddress` type. 

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

Now we have all the individual fields of the `User` record, we can return it from `trial` computation expression

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

The `userResult` is of type `Result<User, string>` with the failure (of `string` type) side representing the validation error that may occur while mapping the user representation from the database to the domain model. It also means that data that we retrieved in not consistent and hence we need to treat this failure as Exception. 

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
    | None -> return None
    | Some user -> 
      let! user = mapUser user
      return Some user
  }
```

