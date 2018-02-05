---
title: "Introducing FsConfig"
date: 2018-02-04T13:48:26+05:30
tags: ["fsharp"]
draft: true
---

I am delighted to introduce and open source a new F# library, [FsConfig](https://github.com/demystifyfp/FsConfig). FsConfig is a F# library for reading configuration data from environment variables and AppSettings with type safety

## Why FsConfig?

To understand FsConfig, let's have a look at an use case from the [FsTweet](https://github.com/demystifyfp/FsTweet) application.

The FsTweet application follows the [The Twelve-Factor App](https://12factor.net/config) guideline for managing the configuration data. During the application bootstrap, it retrieves its ten confirguration parameters from their respective environment variables.

```fsharp
open System

let main argv =

  let fsTweetConnString = 
   Environment.GetEnvironmentVariable  "FSTWEET_DB_CONN_STRING"

  let serverToken =
    Environment.GetEnvironmentVariable "FSTWEET_POSTMARK_SERVER_TOKEN"

  let senderEmailAddress =
    Environment.GetEnvironmentVariable "FSTWEET_SENDER_EMAIL_ADDRESS"

  let env = 
    Environment.GetEnvironmentVariable "FSTWEET_ENVIRONMENT"

  let streamConfig : GetStream.Config = {
      ApiKey = 
        Environment.GetEnvironmentVariable "FSTWEET_STREAM_KEY"
      ApiSecret = 
        Environment.GetEnvironmentVariable "FSTWEET_STREAM_SECRET"
      AppId = 
        Environment.GetEnvironmentVariable "FSTWEET_STREAM_APP_ID"
  }

  let serverKey = 
    Environment.GetEnvironmentVariable "FSTWEET_SERVER_KEY"

  let port = 
    Environment.GetEnvironmentVariable "PORT" |> uint16

  // ...
```

Though the code snippet does the job, there are some shorcomings.

1. The code is verbose.
2. There is no error handling to deal with absence of values and bad values.
3. Explicit type casting

With the help of FsConfig, we can overcome these limitations by specifying the configuration data as a F# Record type.

```fsharp
type StreamConfig = {
  Key : string
  Secret : string
  AppId : string
}

[<Convention("FSTWEET")>]
type Config = {

  DbConnString : string
  PostmarkServerToken : string
  SenderEmailAddress : string
  ServerKey : string
  Environment : string

  [<CustomName("PORT")>]
  Port : uint16
  Stream : StreamConfig
}
```

And then read all the associated environment variables in a single function call with type safety and error handling!

```fsharp
let main argv =

  let config = 
    match EnvConfig.Get<Config>() with
    | Ok config -> config
    | Error error -> 
      match error with
      | NotFound envVarName -> 
        failwithf "Environment variable %s not found" envVarName
      | BadValue (envVarName, value) ->
        failwithf "Environment variable %s has invalid value" envVarName value
      | NotSupported msg -> 
        failwith msg
```

## Supported Data Types

FsConfig supports the following data types and leverages their `TryParse` function to do the type conversion.

* `Int16`, `Int32`, `Int64`, `UInt16`, `UInt32`, `UInt64`
* `Byte`, `SByte`
* `Single`, `Double`, `Decimal`
* `Char`, `String`
* `Bool`
* `TimeSpan`, `DateTimeOffset`, `DateTime`
* `Guid`
* `Enum`

### Option Type

FsConfig allows you to specify optional configuration parameters using the `option` type. In the previous example, if the configuration parameter `Port` is optional, we can specify it like 

```diff
type Config = {
   ...
-  Port : uint16
+  Port : uint16 option
}
```

### List Type

FsConfig also supports `list` type and it expects that individual values are separated by comma. For example, to support mulitple ports, we can define the config as 

```fsharp
type Config = {
  Port : uint16 list
}
```

and then pass the value `8084,8085,8080` using the environment variable `PORT`.

### Record Type

As shown in the [initial example]({{< ref "#why-fsconfig" >}}), FsConfig allows you to group similar configuration into a record type.

```fsharp
type AwsConfig = {
  AccessKeyId : string
  DefaultRegion : string
  SecretAccessKey : string
}

type Config = {
  Aws : AwsConfig
}
```

> With this configuration defintion, FsConfig read the environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION` and populates the `Aws` property of type `AwsConfig`.


## Acknowledgements

The idea of FsConfig is inspired from [Kelsey Hightower](https://twitter.com/kelseyhightower)'s golang library [envconfig](https://github.com/kelseyhightower/envconfig). FsConfig uses [Eirik Tsarpalis](https://twitter.com/eiriktsarpalis)'s [TypeShape](https://github.com/eiriktsarpalis/TypeShape) library for generic programming. 


