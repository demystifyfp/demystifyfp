---
title: "Orchestrating User Signup"
date: 2017-08-28T09:38:55+05:30
draft: true
tags: [Chessie, rop, suave, fsharp]
---

Hi,

Welcome back to the seventh part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series.

In this part we will be orchestrating the user signup usecase. 

## Requirments

Before dive into the implementation, let's spend some to jot down the requirement of the user sign up process. 

1. If the user submitted invalid details, we should let him/her to know about the error (which we already implemented in the [fifth]({{< relref "user-signup-validation.md" >}}) part)

2. We also need to check the whether the username or the email provided by the user has been already used by someone else and report it, if we found it is not available.

3. If all the details are fine, then we need to persist the user details with his password hashed and also a randomly generated verification code. 

4. Then we need to send an email to the provided email address with the verification code. 

5. Upon receiving an URL with the verification code, the user will be nagvigating to the provided URL to complete his singup process. 


In this blog post we are going to implement the [the service layer](https://lostechies.com/jimmybogard/2008/08/21/services-in-domain-driven-design/) part of the user signup which co-ordinates the steps 2 to 4.


## Generating Password Hash

As a first step, let's generate the hash for the password provided by the user. 

To generate the hash we are going to use [the Bcrypt](https://en.wikipedia.org/wiki/Bcrypt) algorithm. In .NET we can leverage this algorithm to generate hash using the [Bcrypt.Net](https://github.com/BcryptNet/bcrypt.net) library.

Let's add its NuGet package to our Web project
```bash
> forge paket add BCrypt.Net-Next \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

Then in the `Domain` module add a new type, `PasswordHash` 

```fsharp
// UserSignup.fs
module Domain =
  // ...
  open BCrypt.Net
  // ...
  type PasswordHash = private PasswordHash of string with
    member this.Value =
      let (PasswordHash passwordHash) = this
      passwordHash

    static member Create (password : Password) =
      BCrypt.HashPassword(password.Value)
      |> PasswordHash
```

As [we did]({{< relref "user-signup-validation.md#making-the-illegal-states-unrepresentable">}}) for the other Domain types `PasswordHash` has a private constructor function to prevent it from creating from outside. 

The static function `Create` takes care of creating the password hash from the provided password using the `Bcrypt` library. 

The `Value` property provides the underlying string representation of the `PasswordHash` type. We will be using while persisting the user details. 

> We are placing all the `Domain` types in `UserSignup` namespace now. Some of the types that we declared here may be needed for the other usecases. We will be doing the module reorganization when we require it. 

## Generating Random Verification Code

Like `PasswordHash`, let's create a domain type for the verification code with a `Value` property and a static function to `Create` it.

```fsharp
// UserSignup.fs
module Domain =
  // ...
  open System.Security.Cryptography
  // ...
  type VerificationCode = private VerificationCode of string with
    member this.Value =
      let (VerificationCode verificationCode) = this
      verificationCode
    static member Create () =
      use rngCsp = new RNGCryptoServiceProvider()
      let verificationCodeLength = 15
      let b : byte [] = 
        Array.zeroCreate verificationCodeLength
      rngCsp.GetBytes(b)
      System.Convert.ToBase64String b
      |> VerificationCode 
```

We are making use of [RNGCryptoServiceProvider](https://msdn.microsoft.com/en-us/library/system.security.cryptography.rngcryptoserviceprovider(v=vs.110).aspx) from the .NET standard library to generate the random bytes and convert them to a string using [Base64Encoding](https://msdn.microsoft.com/en-us/library/dhx0d524(v=vs.110).aspx)

## A Type For The Create User Function

We now have both the `PasswordHash` and the random `VerifcationCode` in place to persist them along with the other user details. 

As a first step towards persisting a new user details, let's define a type signature for the Create User function that we will be implementing in the next blog post. 

First we need a type to represent the create user request
```fsharp
// UserSignup.fs
module Domain =
  // ...
  type CreateUserRequest = {
    Username : Username
    PasswordHash : PasswordHash
    Email : EmailAddress
    VerificationCode : VerificationCode
  }
  // ...
```
Then we need to have a type for the response. We will be returning the primary key that has been generated from the PostgreSQL database.  

```fsharp
// UserSignup.fs
module Domain =
  // ...
  type UserId = UserId of int
  // ...
```

As creating a new user is a database operation, things might go wrong and we also need to check the uniqueness of the `Username` and the `Email`. 

Let's define types for accomodating these scenarios as well.

```fsharp
// UserSignup.fs
module Domain =
  // ...
  type CreateUserError =
  | EmailAlreadyExists
  | UsernameAlreadyExists
  | Error of System.Exception
  // ...
```

With the help of the types that we declared so far we can now write the type for the create user function

```fsharp
type CreateUser = 
    CreateUserRequest -> AsyncResult<UserId, CreateUserError>
```

The [AsyncResult](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-asyncresult-2.html) type is from the [Chessie](https://fsprojects.github.io/Chessie/) library. It represents the [Result](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-result-2.html) of an [asynchronous](https://fsharpforfunandprofit.com/posts/concurrency-async-and-parallel/) computation.  

