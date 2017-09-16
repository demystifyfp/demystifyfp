---
title: "Orchestrating User Signup"
date: 2017-08-28T09:38:55+05:30
tags: [Chessie, rop, fsharp]
---

Hi,

Welcome back to the seventh part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series.

In this part, we will be orchestrating the user signup use case. 

## Requirements

Before diving into the implementation, let's spend some time to jot down the requirements of the user sign up. 

1. If the user submitted invalid details, we should let him/her know about the error (which we already implemented in the [fifth]({{< relref "user-signup-validation.md" >}}) part)

2. We also need to check the whether the username or the email provided by the user has been already used by someone else and report it if we found it is not available.

3. If all the details are well, then we need to persist the user details with his password hashed and also a randomly generated verification code. 

4. Then we need to send an email to the provided email address with the verification code. 

5. Upon receiving an URL with the verification code, the user will be navigating to the provided URL to complete his signup process. 


In this blog post, we are going to implement the [service layer](https://lostechies.com/jimmybogard/2008/08/21/services-in-domain-driven-design/) part of the user signup which coordinates the steps two, three and four.


## Generating Password Hash

As a first step, let's create the hash for the password provided by the user. 

To generate the hash, we are going to use [the Bcrypt](https://en.wikipedia.org/wiki/Bcrypt) algorithm. In .NET we can use the [Bcrypt.Net](https://github.com/BcryptNet/bcrypt.net) library to create the password hash using the Bcrypt algorithm.

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

As [we did]({{< relref "user-signup-validation.md#making-the-illegal-states-unrepresentable">}}) for the other Domain types, `PasswordHash` has a private constructor function to prevent it from creating from outside. 

The static function `Create` takes care of creating the password hash from the provided password using the `Bcrypt` library. 

The `Value` property provides the underlying string representation of the `PasswordHash` type. We will be using while persisting the user details. 

> We are placing all the `Domain` types in `UserSignup` namespace now. Some of the types that we declared here may be needed for the other use cases. We will be doing the module reorganization when we require it. 

## Generating Random Verification Code

Like `PasswordHash`, let's create a domain type for the verification code with a `Value` property and a static function to create it.

```fsharp
// UserSignup.fs
module Domain =
  // ...
  open System.Security.Cryptography
  // ...
  let base64URLEncoding bytes =
    let base64String = 
       System.Convert.ToBase64String bytes
    base64String.TrimEnd([|'='|])
      .Replace('+', '-').Replace('/', '_')

  type VerificationCode = private VerificationCode of string with

    member this.Value =
      let (VerificationCode verificationCode) = this
      verificationCode

    static member Create () =
      let verificationCodeLength = 15
      let b : byte [] = 
        Array.zeroCreate verificationCodeLength
      
      use rngCsp = new RNGCryptoServiceProvider()
      rngCsp.GetBytes(b)

      base64URLEncoding b
      |> VerificationCode 
```

We are making use of [RNGCryptoServiceProvider](https://msdn.microsoft.com/en-us/library/system.security.cryptography.rngcryptoserviceprovider(v=vs.110).aspx) from the .NET standard library to generate the random bytes and convert them to a string using [Base64Encoding](https://msdn.microsoft.com/en-us/library/dhx0d524(v=vs.110).aspx) and making it safer to use in URL as mentioned in [this StackOverflow answer](https://stackoverflow.com/a/26354677). 


## Canonicalizing Username And Email Address

To enable the uniqueness check on the `Username` and the `EmailAddress` fields, we need to canonicalize both of them.

In our case, trimming the white-space characters and converting to the string to lower case should suffice. 

To do it, we can use the existing `TryCreate` function in the `Username` and `EmailAddress` type. 

```fsharp
type Username = private Username of string with
    static member TryCreate (username : string) =
      match username with
      // ...
      | x -> 
        x.Trim().ToLowerInvariant() 
        |> Username |> ok
    // ...

// ...

type EmailAddress = private EmailAddress of string with
  // ...
  static member TryCreate (emailAddress : string) =
    try 
      // ...
      emailAddress.Trim().ToLowerInvariant() 
      |>  EmailAddress  |> ok
    // ...
```

## A Type For The Create User Function

We now have both the `PasswordHash` and the random `VerifcationCode` in place to persist them along with the canonicalized `Username` and `EmailAddress`. 

As a first step towards persisting new user details, let's define a type signature for the Create User function that we will be implementing in an upcoming blog post. 

First, we need a type to represent the create user request

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

As creating a new user is a database operation, things might go wrong. We also need to account the uniqueness check of the `Username` and the `Email` properties. 

Let's define types for accommodating these scenarios as well.

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

With the help of the types that we declared so far, we can now declare the type for the create user function

```fsharp
type CreateUser = 
    CreateUserRequest -> AsyncResult<UserId, CreateUserError>
```

The [AsyncResult](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-asyncresult-2.html) type is from the [Chessie](https://fsprojects.github.io/Chessie/) library. It represents the [Result](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-result-2.html) of an [asynchronous](https://fsharpforfunandprofit.com/posts/concurrency-async-and-parallel/) computation.  

## A Type For The Send Signup Email Function

Upon creating a new user, we need to send a new signup email to the user. Let's create type for this as we did for `CreateUser`. 

The inputs for this function are `Username`, `EmailAddress`, and the `VerificationCode`. 

```fsharp
// UserSignup.fs
module Domain =
  // ...
  type SignupEmailRequest = {
    Username : Username
    EmailAddress : EmailAddress
    VerificationCode : VerificationCode
  }
  // ...
```

As sending an email may fail, we need to have a type for representing it as well

```fsharp
module Domain =
  // ...
  type SendEmailError = SendEmailError of System.Exception
  // ...
```

If the email sent successfully, we would be returning `unit` .

With the help of these two types, we can declare the `SendSignupEmail` type as 

```fsharp
module Domain =
  // ...  
  type SendSignupEmail = 
    SignupEmailRequest -> AsyncResult<unit, SendEmailError>
  // ...
```

## Defining The SignupUser Function Signature

The `SignupUser` function makes use of `CreateUser` and `SendSignupEmail` functions to complete the user sign up process. 

In addition to these two functions, the `SignupUser` function takes a record of type `UserSignupRequest` as its input but what about the output?

```fsharp
type SignupUser = 
    CreateUser -> SendSignupEmail -> UserSignupRequest 
      -> ???
```

There are possible outcomes

1. `CreateUser` may fail
2. `SendSignupEmail` may fail
3. User successfully signed up. 

We can group the two failure conditions into a single type

```fsharp
module Domain =
  // ...  
  type UserSignupError =
  | CreateUserError of CreateUserError
  | SendEmailError of SendEmailError
  // ...
```

For successful signup, we will be returning a value of type `UserId`, which we declared earlier. 

```fsharp
type SignupUser = 
    CreateUser -> SendSignupEmail -> UserSignupRequest 
      -> AsyncResult<UserId, UserSignupError>
```

> We are not going to use this `SignupUser` type anywhere else, and it is just for illustration. 

## Implementing The SignupUser Function

Now we know the inputs and the outputs of the `SignupUser` function, and it is time to get our hands dirty!

```fsharp
module Domain =
  // ...  
  let signupUser (createUser : CreateUser) 
                 (sendEmail : SendSignupEmail) 
                 (req : UserSignupRequest) = asyncTrial {
    // TODO
  }
``` 

Like the [trial]({{< relref "user-signup-validation.md#making-the-illegal-states-unrepresentable">}}) computation that we used to do the user signup form validation, the [asyncTrail](https://fsprojects.github.io/Chessie/reference/chessie-errorhandling-asynctrial-asynctrialbuilder.html) computation expression is going to help us here to do the error handling in asynchronous operations. 

The first step is creating a value of type `CreateUserRequest` from `UserSignupRequest`

```fsharp
let signupUser ... (req : UserSignupRequest) = asyncTrail {
  let createUserReq = {
    PasswordHash = PasswordHash.Create req.Password
    Username = req.Username
    Email = req.EmailAddress
    VerificationCode = VerificationCode.Create()
  }
  // TODO
}
```
> The `...` notation is just a convention that we are using here to avoid repeating the parameters, and it is not part of the fsharp language syntax 

The next step is calling the `createUser` function with the `createUserReq`

```fsharp
let signupUser (createUser : CreateUser) ... = asyncTrail {
  let createUserReq = // ...
  let! userId = createUser createUserReq
  // TODO
}
```

Great! We need to send an email now. Let's `do` it!

Steps involved are creating a value of type `SignupEmailRequest` and calling the `sendEmail` function with this value.

As the `sendEmail` function returning `unit` on success, we can use the `do!` notation instead of `let!` 

```fsharp
let signupUser ... (sendEmail : SendSignupEmail) ... = asyncTrail {
  let createUserReq = // ...
  let! userId = // ...
  let sendEmailReq = {
    Username = req.Username
    VerificationCode = createUserReq.VerificationCode
    EmailAddress = createUserReq.Email
  }
  do! sendEmail sendEmailReq
  // TODO
}
```

Now you would be getting a compiler error 

![Bind Error](/img/fsharp/series/fstweet/bind-error.png)

Would you be able to find why are we getting this compiler error?

To figure out the solution, let's go back [to the TryCreate function](https://github.com/demystifyfp/FsTweet/blob/v0.4/src/FsTweet.Web/UserSignup.fs#L42-L52) in `UserSignupRequest` type.

```fsharp
// ...
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

The signature of the `TryCreate` function is

```fsharp
(string, string, string) -> Result<UserSignupRequest, string>
```

The signature of the `TryCreate` function of the Domain types are

```fsharp
string -> Result<Username, string>
string -> Result<Password, string>
string -> Result<EmailAddress, string>
```

Let's focus our attention to the type that represents the result of a failed computation

```fsharp
... -> Result<..., string>
... -> Result<..., string>
... -> Result<..., string>
```

All are of `string` type!

Coming back to the `signupUser` function what we are implementing, here is a type signature of the functions

```fsharp
... -> AsyncResult<..., CreateUserError>
... -> AsyncResult<..., SendEmailError>
```

In this case, the types that are representing the failure are of different type. That's thing that we need to fix!

![Async Trail Output Mismatch](/img/fsharp/series/fstweet/asynctrail-bind-shape.png)
  
If we transform (or map) the failure type to `UserSignupError`, then things would be fine!

![Map Failure](/img/fsharp/series/fstweet/user_signup_map_failure.png)

## Mapping AsyncResult Failure Type

> You may find this section hard or confusing to get it in the first shot. A recommended approach would be working out the following implementation on your own and use the implementation provided here as a reference. And also if you are thinking of taking a break, this is a right time!

We already have a union cases which maps `CreateUserError` and `SendEmailError` types to `UserSignupError`

```fsharp
type UserSignupError =
| CreateUserError of CreateUserError
| SendEmailError of SendEmailError
```

These union case identifiers are functions which have the following signature

```fsharp
CreateUserError -> UserSignupError
SendEmailError -> UserSignupError
```

But we can't use it directly, as the `CreateUserError` and the `SendEmailError` are part of the `AsyncResult` type!

What we want to achieve is mapping 

```fsharp
AsyncResult<UserId, CreateUserError>
```
to 

```fsharp
AsyncResult<UserId, UserSignupError>
```

and

```fsharp
AsyncResult<unit, SendEmailError>
```

to 

```fsharp
AsyncResult<unit, UserSignupError>
```

Accomplishing this mapping is little tricky. 

Let's start our mapping by defining a new function called `mapAsyncFailure`

```fsharp
// UserSignup.fs
module Domain =
  // ...
  let mapAsyncFailure f aResult =
    // TODO
```

The `mapAsyncFailure` function is a generic function with the following type signature. 

```fsharp
'a -> 'b -> AsyncResult<'c, 'a> -> AsyncResult<'c, 'b>
```

It takes a function `f` which maps a type `a` to `b` and an `AsyncResult` as its input. Its output is an `AsyncResult` with its failure type mapped using the given function `f`. 

The first step to do this mapping is to transform 

```fsharp
AsyncResult<'c, 'a>
```
to

```fsharp
Async<Result<'c, 'a>>
```

The `AsyncResult` type is defined in Chessie as a single case discriminated union case `AR`
```fsharp
type AsyncResult<'a, 'b> = 
  | AR of Async<Result<'a, 'b>>
```

The Chessie library already has a function, `ofAsyncResult`, to carry out this transformation (or unboxing!)

```fsharp
let mapAsyncFailure f aResult =
  aResult
  |> Async.ofAsyncResult 
```

The next step is mapping the value that is part of the `Async` type. 

```fsharp
Async<'a> -> Async<'b>
```

We can again make use of the Chessie library again by using its `map` function. This map function like other `map` functions in the fsharp standard module takes a function as its input to do the mapping.

```fsharp
'a -> 'b -> Async<'a> -> Async<'b>
```

The easier way to understand is to think `Async` as a box. All mapping function does is takes the value out of the `Async` box, perform the mapping using the provided function, then put it to back to a new `Async` box and return it.

![Async Map](/img/fsharp/series/fstweet/async-map.png)

But what is the function that we need to give to the `map` function to do the mapping

```fsharp
let mapAsyncFailure f aResult =
  aResult
  |> Async.ofAsyncResult 
  |> Async.map ???
```

We can't give the `CreateUserError` union case function directly as the `f` parameter here; it only maps `CreateUserError` to `UserSignupError`. 

The reason is, the value inside the `Async` is not `CreateUserError`, it's `Result<UserId, CreateUserError>`.

We need to have an another map function which maps the failure part of the `Result` type

![Result Map Failure](/img/fsharp/series/fstweet/result-map-failure.png)

Let's assume that we have `mapFailure` function which takes a function `f` to do this failure type mapping on the `Result` type. 

We can continue with the definition of the `mapAsyncFailure` function using this `mapFailure` function.

```fsharp
let mapAsyncFailure f aResult =
  aResult
  |> Async.ofAsyncResult 
  |> Async.map (mapFailure f)
```

The final step is putting the `Async` of `Result` type back to `AsyncResult` type. As `AsyncResult` is defined as single case discriminated union, we can use the `AR` union case to complete the mapping.

```fsharp
let mapAsyncFailure f aResult =
  aResult
  |> Async.ofAsyncResult 
  |> Async.map (mapFailure f)
  |> AR
```

The `mapFailure` is not part of the codebase yet. So, Let's add it before going back to the `signupUser` function.

The Chessie library already has a `mapFailure` function. But the mapping function parameter maps a list of errors instead of a single error

```fsharp
'a list -> 'b list -> Result<'c, 'a list> -> Result<'c, 'b list> 
```

The reason for this signature is because the library treats failures as a list in the `Result` type. 

As we are treating the failure in the `Result` type as a single item, we can't directly make use of it.

However, we can leverage it to fit our requirement by having an implementation, which takes the first item from the failure list, call the mapping function and then create a list from the output of the map function.

```fsharp
// UserSignup.fs
module Domain =
  // ...
  let mapFailure f aResult = 
    let mapFirstItem xs = 
      List.head xs |> f |> List.singleton 
    mapFailure mapFirstItem aResult
  // ...
```

This `mapFailure` function has the signature

```fsharp
'a -> 'b -> Result<'c, 'a> -> Result<'c, 'b> 
```

With this, we are done with the mapping of `AsyncResult` failure type.

## Going Back To The signupUser Function

In the previous section, we implemented a solution to fix the compiler error that we encountered while defining the `signupUser` function. 

With the `mapAsyncFailure` function, we can rewrite the `signupUser` function to transform the error type and return the `UserId` if everything goes well.

```fsharp
module Domain =
  // ...
  let signupUser ...= asyncTrial {
    
    let createUserReq = // ...
    let! userId = 
      createUser createUserReq
      |> mapAsyncFailure CreateUserError
    let sendEmailReq = // ...
    do! sendEmail sendEmailReq 
        |> mapAsyncFailure SendEmailError

    return userId
  }
```

That's it!!

## Summary

One of the key take away of this blog post is how we can solve a complex problem in fsharp by just focusing on the function signature.  

We also learned how to compose functions together, transforming the values using the map function to come up with a robust implementation. 

The source code is available on the [GitHub Repository](https://github.com/demystifyfp/FsTweet/tree/v0.6)