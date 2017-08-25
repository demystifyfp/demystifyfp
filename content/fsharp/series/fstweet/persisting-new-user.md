---
title: "Persisting New User"
date: 2017-08-26T04:43:18+05:30
draft: true
---

```bash
> forge paket add BCrypt.Net-Next -p src/FsTweet.Web/FsTweet.Web.fsproj
```

```fsharp
module Domain =
  // ...
  type PasswordHash = private PasswordHash of string with
    member this.Value =
      let (PasswordHash passwordHash) = this
      passwordHash

    member this.Match password =
      BCrypt.Verify(password, this.Value) 

    static member Create (password : Password) =
      let hash = BCrypt.HashPassword(password.Value)
      PasswordHash hash
```
```fsharp
module Domain =
  type UserSignupRequest = {
    // ...
    PasswordHash PasswordHash
  }
  with static member TryCreate (username, password, email) =
        trial {
          // ...
          return {
            // ...
            PasswordHash = PasswordHash.Create password
          }
        }
```

```fsharp
module Domain =
  // ...
  type UserId = UserId of int
  type VerificationCode = VerificationCode of string

  type CreateUserError =
  | EmailAlreadyExists
  | UsernameAlreadyExists
  | OperationError of System.Exception

  type UserSignupResponse = {
    UserId : UserId
    VerificationCode : VerificationCode
  }

  type CreateUser = 
    UserSignupRequest -> AsyncResult<UserSignupResponse, CreateUserError>
```

```bash
> forge paket add Npgsql -p src/FsTweet.Web/FsTweet.Web.fsproj
> forge paket add Rezoom.SQL.Provider -p src/FsTweet.Web/FsTweet.Web.fsproj
> forge paket add Rezoom.SQL.Provider.Postgres -p src/FsTweet.Web/FsTweet.Web.fsproj
```

