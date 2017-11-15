---
title: "Sending Verification Email"
date: 2017-09-09T22:46:00+05:30
tags: [fsharp, Postmark, Chessie, rop]
---

Hi there!

Welcome to the tenth part of [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}) blog post series. 

In this blog post, we are going to add support for sending an email to verify the email address of a new signup, which we [faked earlier]({{< relref "transforming-async-result-to-webpart.md#adding-fake-implementations-for-persistence-and-email" >}}). 

## Setting Up Postmark

To send email, we are going to use [Postmark](https://postmarkapp.com/), a transactional email service provider for web applications.

There are three prerequisites that we need to do before we use it in our application. 

1. A [user account](https://account.postmarkapp.com/sign_up) in Postmark

2. A new [server](https://account.postmarkapp.com/servers), kind of namespace to manage different applications in Postmark. 

3. A [sender signature](https://account.postmarkapp.com/servers), to use as a FROM address in the email that we will be sending from FsTweet.

You make use of this [Getting started](https://postmarkapp.com/support/article/1002-getting-started-with-postmark) guide from postmark to get these three prerequisites done.


### Configuring Signup Email Template

The next step is creating [an email template](https://postmarkapp.com/why/templates) in Postmark for the signup email. 

Here is the HTML template that we will be using

```markdown
Hi {{ username }},

Welcome to FsTweet!

Confirm your email by clicking the below link

http://localhost:8080/signup/verify/{{ verification_code }}

Cheers,
www.demystifyfp.com
```

> HTML tags are not shown for brevity.

The `username` and the `verification_code` are placeholders in the template, that will be populated with the actual value while sending the email.

Upon saving the template, you will get a unique identifier, like `3160924`. Keep a note of it as we will be using it shortly.

With these, we completed the setup on the Postmark side.


## Abstractions For Sending Emails

Postmark has a dotnet [client library](https://www.nuget.org/packages/Postmark/) to make our job easier.

As a first step, we have to add its NuGet package in our web project. 

```bash
> forge paket add Postmark -g Email \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

Then, create a new file `Email.fs` in the web project and move it above `UserSignup.fs` file

```bash
> forge newFs web -n src/FsTweet.Web/Email
> forge moveUp web -n src/FsTweet.Web/Email.fs
> forge moveUp web -n src/FsTweet.Web/Email.fs
```

Let's add some basic types that we required for sending an email

```fsharp
// FsTweet.Web/Email.fs
module Email

open Chessie.ErrorHandling
open System

type Email = {
  To : string
  TemplateId : int64
  PlaceHolders : Map<string,string>
}

type SendEmail = Email -> AsyncResult<unit, Exception>
```

The `Email` record represents the required details for sending an email, and the `SendEmail` represents the function signature of a send email function. 

The next step is adding a function which sends an email using Postmark.

```fsharp
// ...
open PostmarkDotNet
// ...

let sendEmailViaPostmark senderEmailAddress (client : PostmarkClient) email =
  // TODO
```

The `sendEmailViaPostmark` function takes the sender email address that we created as part of the third prerequisite while setting up Postmark, a `PostmarkClient` and a value of the `Email` type that we just created. 

Then we need to create an object of type `TemplatedPostmarkMessage` and call the `SendMessageAsync` method on the postmark client.

```fsharp
let sendEmailViaPostmark senderEmailAddress (client : PostmarkClient) email =
  let msg = 
    new TemplatedPostmarkMessage(
      From = senderEmailAddress,
      To = email.To,
      TemplateId = email.TemplateId,
      TemplateModel = email.PlaceHolders
    )
  client.SendMessageAsync(msg)
```

The return type of `SendMessageAsync` method is `Task<PostmarkResponse>`. But what we need is `AsyncResult<unit, Exception>`. 

I guess you should know what we need to do now? Yes, transform!

```fsharp
let sendEmailViaPostmark ... =
  // ...
  client.SendMessageAsync(msg) // Task<PostmarkResponse>
  |> Async.AwaitTask // Async<PostmarkResponse>
  |> Async.Catch // Choice<PostmarkResponse, Exception>
  // TODO
```

By making use of the [AwaitTask](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/async.awaittask%5B%27t%5D-method-%5Bfsharp%5D) and the [Catch](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/async.catch%5b't%5d-method-%5bfsharp%5d) function in the `Async` module, we transformed `Task<PostmarkResponse>` to `Choice<PostmarkResponse, Exception>`.

To convert this choice type to `AsyncResult<unit, Exception>`, we need to know little more details. 

The `PostmarkClient` would populate the `Status` property of the `PostmarkResponse` with the value `Success` if everything went well. We need to return a `unit` in this case. 

If the `Status` property doesn't have the `Success` value, the `Message` property of the `PostmarkResponse` communicates what went wrong. 

With these details, we can now write a function that transforms `Choice<PostmarkResponse, Exception>` to `Result<unit, Exception>`

```fsharp
// FsTweet.Web/Email.fs
// ...
open System
// ...
let mapPostmarkResponse response =
  match response with
  | Choice1Of2 ( postmarkRes : PostmarkResponse) ->
    match postmarkRes.Status with
    | PostmarkStatus.Success -> 
      ok ()
    | _ ->
      let ex = new Exception(postmarkRes.Message)
      fail ex
  | Choice2Of2 ex -> fail ex
```

Now we have a function that map `Choice` to `Result`. 

Going back to the `sendEmailViaPostmark` function, we can leverage this `mapPostmarkResponse` function to accomplish our initial objective. 

```fsharp
let sendEmailViaPostmark ... =
  // ...
  client.SendMessageAsync(msg) // Task<PostmarkResponse>
  |> Async.AwaitTask // Async<PostmarkResponse>
  |> Async.Catch // Choice<PostmarkResponse, Exception>
  |> Async.map mapPostmarkResponse // Async<Result<unit, Exception>>
  |> AR // AsyncResult<unit, Exception>
```

Awesome! We transformed `Task<PostmarkResponse>` to `AsyncResult<unit, Exception>`.

## Injecting The Dependencies

There are two dependencies in the `sendEmailViaPostmark` function, `senderEmailAddress`, and `client`. 

Let's write a function to inject these dependencies using partial application

```fsharp
// FsTweet.Web/Email.fs
// ...
let initSendEmail senderEmailAddress serverToken =
  let client = new PostmarkClient(serverToken)
  sendEmailViaPostmark senderEmailAddress client
```

The `serverToken` parameter represents the [Server API token](https://postmarkapp.com/support/article/1008-what-are-the-account-and-server-api-tokens) which will be used by the `PostmarkClient` while communicating with the Postmark APIs to send an email. 

The `initSendEmail` function partially applied the first two arguments of the `sendEmailViaPostmark` function and returned a function having the signature
`Email -> AsyncResult<unit, Exception>`.


Then during the application bootstrap, get the sender email address and the Postmark server token from environment variables and call the `initSendEmail` function to get a function to send an email. 

```fsharp
// FsTweet.Web/FsTweet.Web.fs
// ...
open Email
// ...
let main argv =
  // ...
  let serverToken =
    Environment.GetEnvironmentVariable "FSTWEET_POSTMARK_SERVER_TOKEN"

  let senderEmailAddress =
    Environment.GetEnvironmentVariable "FSTWEET_SENDER_EMAIL_ADDRESS"

  let sendEmail = initSendEmail senderEmailAddress serverToken

  // ...
```

The next step is adding the `sendEmail` function as a parameter in the `sendSignupEmail` function 

```fsharp
// FsTweet.Web/UserSignup.fs
// ...
module Email =
  // ...
  open Email

  let sendSignupEmail sendEmail signupEmailReq = asyncTrial {
    // ...
  }
```

and pass the actual `sendEmail` function to it from the `main` function. 


```fsharp
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  // ...
  let app = 
    choose [
      // ...
      UserSignup.Suave.webPart getDataCtx sendEmail
    ]
  // ...
```

```fsharp
// FsTweet.Web/UserSignup.fs
// ...
module Suave =
  // ...
  let webPart getDataCtx sendEmail =
    // ...
    let sendSignupEmail = Email.sendSignupEmail sendEmail
    // ...
```

## Sending Signup Email

Everything has been setup to send an email to verify the email account of a new Signup.

The final task is putting the pieces together in the `sendSignupEmail` function. 

```fsharp
// FsTweet.Web/UserSignup.fs
// ...
module Email =
  // ...
  let sendSignupEmail sendEmail signupEmailReq = asyncTrial {
    let verificationCode =
      signupEmailReq.VerificationCode.Value
    let placeHolders = 
      Map.empty
        .Add("verification_code", verificationCode)
        .Add("username", signupEmailReq.Username.Value)
    let email = {
      To = signupEmailReq.EmailAddress.Value
      TemplateId = int64(3160924)
      PlaceHolders = placeHolders
    }
    do! sendEmail email 
      |> mapAsyncFailure Domain.SendEmailError
  }
```

The implementation of the `sendSignupEmail` function is striaght forward. We need to populate the individual properties of the `Email` record type with the appropriate values and then call the `sendEmail` email.

Note that we are using `do!` as `sendEmail` asynchronously returing `unit` for success. 

As usual, we are mapping the failure type of the Async result from `Exception` to `SendEmailError`

## Configuring Send Email During Development

In a typical application development process, we won't be sending actual email in the development environment as sending an email may cost money. 

One of the standard ways is faking the implementation and using the console as we did earlier. 

To enable this in our application,  let's add a new function `consoleSendEmail` function which prints the email record type in the console 

```fsharp
// FsTweet.Web/Email.fs
// ...
let consoleSendEmail email = asyncTrial {
  printfn "%A" email
}
```

Then in the `main` function, get the name of the environment from an environment variable and initialize the `signupEmail` function accordingly.

```fsharp
// FsTweet.Web/FsTweet.Web.fs
// ...
let main argv = 
  // ...
  let env = 
    Environment.GetEnvironmentVariable "FSTWEET_ENVIRONMENT"

  let sendEmail = 
    match env with
    | "dev" -> consoleSendEmail
    | _ -> initSendEmail senderEmailAddress serverToken
  // ...
```

## Summary

With the help of the abstractions and design that we created in the earlier blog posts, we can add support for sending an email with ease in the blog post. 

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.9)