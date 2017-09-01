---
title: "Persisting New User"
date: 2017-08-31T06:55:16+05:30
draft: true
---

```bash
> forge paket add SQLProvider -g Database \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

```bash
> forge paket add Npgsql -g Database \
    --version 3.1.10 \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

```
...
/~/FsTweet/paket.dependencies contains package Npgsql 
  in group Database already. ==> Ignored
...
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
      BCrypt.HashPassword(password.Value)
      |> PasswordHash
```
```fsharp
module Domain =
  // ...
  type CreateUserRequest = {
    Username : Username
    PasswordHash : PasswordHash
    Email : EmailAddress
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

