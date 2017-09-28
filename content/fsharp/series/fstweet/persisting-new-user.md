---
title: "Persisting New User"
date: 2017-08-31T06:55:16+05:30
tags: [chessie, rop, fsharp, SQLProvider]
---

Hi!

Welcome back.

We are on track to complete the user signup feature. In this blog post, we are going to implement the persistence layer for creating a user which [we faked]({{< relref "transforming-async-result-to-webpart.md#adding-fake-implementations-for-persistence-and-email" >}}) in the last blog post. 

## Initializing SQLProvider

We are going to use [SQLProvider](http://fsprojects.github.io/SQLProvider/), a SQL database type provider, to takes care of PostgreSQL interactions, 

As usual, let's add its NuGet package to our *Web* project using paket

```bash
> forge paket add SQLProvider -g Database \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

Then we need to initialize SQLProvider by providing [the required parameters](http://fsprojects.github.io/SQLProvider/core/postgresql.html). 

To do it, let's add a separate fsharp file *Db.fs* in the Web Project

```bash
> forge newFs web -n src/FsTweet.Web/Db
```

Then move this file above *UserSignup.fs*

```bash
> forge moveUp web -n src/FsTweet.Web/Db.fs
> forge moveUp web -n src/FsTweet.Web/Db.fs
```

> We are making use of the *Forge alias* that we set in the [fourth part]({{< relref "user-signup.md#a-new-file-for-user-signup">}})

The next step is initializing the SQLProvider with all the required parameters

```fsharp
// src/FsTweet.Web/Db.fs
module Database

open FSharp.Data.Sql

[<Literal>]
let private connString = 
  "Server=127.0.0.1;Port=5432;Database=FsTweet;" +
    "User Id=postgres;Password=test;"

[<Literal>]
let private npgsqlLibPath = 
  @"./../../packages/database/Npgsql/lib/net451"

[<Literal>]
let private dbVendor = 
  Common.DatabaseProviderTypes.POSTGRESQL

type Db = SqlDataProvider<
            ConnectionString=connString,
            DatabaseVendor=dbVendor,
            ResolutionPath=npgsqlLibPath,
            UseOptionTypes=true>
```

The type `Db` represents the PostgreSQL database provided in the `connString` parameter. The `connString` that we are using here is the same one that we used while running the migration script. 

Like [DbContext](https://msdn.microsoft.com/en-us/library/system.data.entity.dbcontext(v=vs.113).aspx) in Entity Framework, the SQLProvider offers a `dataContext` type to deal with the database interactions. 

The `dataContext` is specific to the database that we provided in the connection string, and this is available as a property of the `Db` type. 

As we will be passing this `dataContext` object around, in all our data access functions, we can define a specific type for it to save some key strokes!

```fsharp
module Database

// ...
type DataContext = Db.dataContext
```

## Runtime Configuration of SQLProvider

In the previous section, we configured SQLProvider to enable typed access to the database. Upon initialization, it queries the meta tables of PostgreSQL database and creates types. These types can be accessed via `DataContext`

It's okay for developing an application and compiling it.

But when the application goes live, we will be certainly pointing to a separate database! To use a different PostgreSQL database at run time, we need a separate `DataContext` pointing to that database. 

As [suggested by the Twelve-Factor app](https://12factor.net/config), let's use an environment variable to provide the connection string.

We are already using one in our build script, which contains the connection string for the migration script. 

```fsharp
// build.fsx
//...
let connString = 
  environVarOrDefault 
    "FSTWEET_DB_CONN_STRING"
    @"Server=127.0.0.1;Port=5432;..."
let dbConnection = 
  ConnectionString (connString, DatabaseProvider.PostgreSQL)
//...
```
The `connString` label here takes the value from the environment variable `FSTWEET_DB_CONN_STRING` if it exists otherwise it picks a default one

If we set the value of this `connString` again to `FSTWEET_DB_CONN_STRING` environment variable, we are ready to go.

Fake has an environment helper function `setEnvironVar` for this 

```fsharp
// build.fsx
// ...
setEnvironVar "FSTWEET_DB_CONN_STRING" connString
// ...
```

Now if we run the application using the fake build script, the environment variable `FSTWEET_DB_CONN_STRING` always has value!

The next step is using this environment variable to get a new data context. 


### DataContext One Per Request

That data context that is being exposed by the SQLProvider uses the [unit of work](https://martinfowler.com/eaaCatalog/unitOfWork.html) pattern underneath. 

So, while using SQLProvider in an application that can be used by multiple users concurrently, we need to create a new data context for every request from the user that involves database operation. 

Let's assume that we have a function `getDataContext`, that takes a connection string and returns its associated SQLProvider's data context. There are two ways that we can use this function to create a new data context per request. 

1. For every database layer function, we can pass the connection string and inside that function that we can call the `getDataContext` using the connection string. 

2. An another option would be modifying the `getDataContext` function to return an another function that takes a parameter of type `unit` and returns the data context of the provided connection string. 

We are going to use the second option as its hides the details of getting an underlying data context. 

Let's see it in action to understand it better

As a first step, define a type that represents the factory function to create a data context.

```fsharp
// src/FsTweet.Web/Db.fs
// ...
type GetDataContext = unit -> DataContext
```

Then define the actual function 

```fsharp
// src/FsTweet.Web/Db.fs
// ...
let dataContext (connString : string) : GetDataContext =
  fun _ -> Db.GetDataContext connString
```

Then in the application bootstrap get the connection string value from the environment variable and call this function to get the factory function to create data context for every request

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
// ...
open System
open Database 
// ...
let main argv =
  let fsTweetConnString = 
    Environment.GetEnvironmentVariable  "FSTWEET_DB_CONN_STRING"
  let getDataCtx = dataContext fsTweetConnString

  // ...
```

The next step is passing the `GetDataContext` function to the request handlers which we will address later in this blog post. 

### Async Transaction in Mono

At the time of this writing, SQLProvider [doesn't support](https://github.com/fsprojects/SQLProvider/blob/1.1.6/src/SQLProvider/SqlRuntime.Transactions.fs#L56-L59) transactions in Mono as the `TransactionScopeAsyncFlowOption` is [not implemented](https://github.com/mono/mono/blob/mono-5.4.0.167/mcs/class/System.Transactions/System.Transactions/TransactionScope.cs#L105-L123) in Mono. 

So, if we use the datacontext from the above factory function in mono, we may get some errors associated with transaction when we asynchronously write any data to the database

To circumvent this error, we can disable transactions in mono alone. 

```fsharp
let dataContext (connString : string) : GetDataContext =
  let isMono = 
    System.Type.GetType ("Mono.Runtime") <> null
  match isMono with
  | true -> 
    let opts = {
      IsolationLevel = 
        Transactions.IsolationLevel.DontCreateTransaction
      Timeout = System.TimeSpan.MaxValue
    } 
    fun _ -> Db.GetDataContext(connString, opts)
  | _ -> 
    fun _ -> Db.GetDataContext connString
```

> Note: This is *NOT RECOMMENDED* in production. 

With this, we are done with the runtime configuration of SQLProvider

## Implementing Create User Function

In the existing fake implementation of the `createUser` add `getDataCtx` as its first parameter and get the data context inside the function.

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Persistence =
  // ...
  open Database

  let createUser (getDataCtx : GetDataContext) 
                  (createUserReq : CreateUserRequest) = asyncTrial {
    let ctx = getDataCtx ()
    // TODO
  }
```

We need to explicitly specify the type of the parameter `GetDataContext` to use the types provided by the SQLProvider.

The next step is creating a new user from the `createUserReq`

```fsharp
let createUser ... = asyncTrail {
  let ctx = getDataCtx ()

  let users = ctx.Public.Users
  let newUser = users.Create()

  newUser.Email <- createUserReq.Email.Value
  newUser.EmailVerificationCode <- 
    createUserReq.VerificationCode.Value
  newUser.Username <- createUserReq.Username.Value
  newUser.IsEmailVerified <- false
  newUser.PasswordHash <- createUserReq.PasswordHash.Value
  // TODO
}
```

Then we need to call the `SubmitUpdatesAsync` method on the `ctx` and return the `Id` of the newly created user.

```fsharp
let createUser ... = asyncTrail {
  // ...
  do! ctx.SubmitUpdatesAsync()
  return UserId newUser.Id
} 
```

Though it appears like that we have completed the functionality, one important task is pending in this function. 

That is Error Handling!

Let's examine the return type of `SubmitUpdatesAsync` method, `Async<unit>`. In case of an error, while submitting the changes to the database, this method will throw an exception. It also applies to unique violation errors in the `Username` and `Email` columns in the `Users` table. That's not what we want! 

We want a value of type `CreateUserError` to represent the errors!

As we did for transforming the `UserSignupResult` to `WebPart` in the [last blog post]({{< relref "transforming-async-result-to-webpart.md#transforming-usersignupresult-to-webpart">}}), we need to transform `AsyncResult<UserId, 'a>` to `AsyncResult<UserId, CreateUserError>`

### Async Exception to Async Result

As a first step, the first transformation that we need to work on is returning an `AsyncResult<unit,Exception>` instead of `Async<unit>` and an exception when we call `SubmitUpdatesAsync` on the `DataContext` object. 

To do, let's create a function `submitChanges` in `Database` module that takes a `DataContext` as its parameter

```fsharp
// src/FsTweet.Web/Db.fs
module Database
// ...
let submitChanges (ctx : DataContext) = 
  // TODO
```

Then call the `SubmitUpdatesAsync` method and use [Async.Catch](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/async.catch%5B't%5D-method-%5Bfsharp%5D) function from the `Async` standard module which catches the exception thrown during the asynchronous operation and return the result of the operation as a `Choice` type.

```fsharp
let submitChanges (ctx : DataContext) = 
  ctx.SubmitUpdatesAsync() // Async<unit>
  |> Async.Catch // Async<Choice<unit, System.Exception>>
  // TODO
```

> The return type of each function has been added as comments for clarity!

The next step is mapping the `Async<Choice<'a, 'b>>` to `Async<Result<'a, 'b>>`

The Chessie library has a function `ofChoice` which transforms a `Choice` type to a `Result` type. With the help of this function and the `Async.map` function from Chessie library we can do the following

```fsharp
module Database
// ...
open Chessie.ErrorHandling
// ...
let submitChanges (ctx : DataContext) = 
  ctx.SubmitUpdatesAsync() // Async<unit>
  |> Async.Catch // Async<Choice<unit, System.Exception>>
  |> Async.map ofChoice // Async<Result<unit, System.Exception>>
  // TODO
```

The final step is transforming it to `AsyncResult` by using the `AR` union case as we did while [mapping the Failure type of AsyncResult]({{< relref "orchestrating-user-signup.md#mapping-asyncresult-failure-type" >}}).

```fsharp
// DataContext -> AsyncResult<unit, System.Exception>
let submitChanges (ctx : DataContext) = 
  ctx.SubmitUpdatesAsync() // Async<unit>
  |> Async.Catch // Async<Choice<unit, System.Exception>>
  |> Async.map ofChoice // Async<Result<unit, System.Exception>>
  |> AR
```

Now we have a functional version of the `SubmitChangesAsync` method which returns an `AsyncResult`. 

### Mapping AsyncResult Failure Type

If you got it right, you could have noticed that we are yet to do a step to complete the error handling. 

We need to transform the failure type of the Async Result from 

```fsharp
AsyncResult<unit, System.Exception>
```
to

```fsharp
AsyncResult<unit, CreateUserError>
```

As this very similar to what we did while [mapping the Failure type of AsyncResult]({{< relref "orchestrating-user-signup.md#mapping-asyncresult-failure-type" >}}) in the previous parts, let's jump in directly.

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
//...
module Persistence =
  // ...
  // System.Exception -> CreateUserError
  let private mapException (ex : System.Exception) =
    Error ex

  let createUser ... = asyncTrail {
    // ...
    do! submitUpdates ctx
        |> mapAsyncFailure mapException
    return UserId newUser.Id
  } 
```

> We will be handling the unique constraint violation errors later in this blog post.

Great! With this, we can wrap up the implementation of the `createUser` function.

## Passing The Dependency

The new `createUser` function takes a first parameter `getDataCtx` of type `GetDataContext`. 

To make it available, first, we need to change the `webPart` function to receive this as a parameter and use it for partially applying it to the `createUser` function

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Suave =
  // ...
  open Database

  let webPart getDataCtx =
    let createUser = 
      Persistence.createUser getDataCtx
    // ...
```

Then in the `main` function call the `webPart` function with the `getDataCtx` which we created in the beginning of this blog post.

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
// ...
let main argv = 
  // ...
  let app = 
    choose [
      // ...
      UserSignup.Suave.webPart getDataCtx
    ]
```

## Handling Unique Constraint Violation Errors

To handle the unique constraint violation errors gracefully, we need to understand some internals of the database abstraction provided by the SQLProvider. 

The SQLProvider internally uses the [Npgsql](http://www.npgsql.org/) library to interact with PostgreSQL. As a matter of fact, through the `ResolutionPath` parameter, we provided a path in which the Npgsql DLL resides. 

The `Npgsql` library throws [PostgresException](http://www.npgsql.org/api/Npgsql.PostgresException.html) when the PostgreSQL backend reports errors (e.g., query SQL issues, constraint violations).

To infer whether the `PostgresException` has occurred due to the violation of the unique constraint, we need to check the `ConstraintName` and the `SqlState` property of this exception. 

For unique constraint violation, the `ConstraintName` property represents the name of the constraint that has been violated and the `SqlState` property, which represents [PostgreSQL error code](https://www.postgresql.org/docs/current/static/errcodes-appendix.html), will have the value `"23505"`.

We can find out the unique constraints name associated with the `Username` and the `Email` by running the `\d "Users"` command in psql. The constraint names are `IX_Users_Username` and `IX_Users_Email` respectively. 

The SQLProvider exposes this `PostgresException` as an `AggregateException`. 

Now we have enough knowledge on how to capture the unique violation exceptions and represent it as a Domain type. So, Let's start our implementation. 

The first step is adding NuGet package reference of `Npgsql`

```bash
> forge paket add Npgsql -g Database \
    --version 3.1.10 \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

> At the time of this writing, there is [an issue](https://github.com/npgsql/npgsql/issues/1603) with the latest version of Npgsql. So, we are using the version `3.1.10` here. 

Then we need to add a reference to `System.Data`, as `PostgresException`, inherits [DbException](https://msdn.microsoft.com/en-us/library/system.data.common.dbexception(v=vs.110).aspx) from this namespace. 

```bash
> forge add reference -n System.Data \
    -p src/FsTweet.Web/FsTweet.Web.fsproj
```

The next step is extending the `mapException` function that we defined in the previous section to map these `PostgresException`s to its corresponding error types. 

```fsharp
// src/FsTweet.Web/UserSignup.fs
// ...
module Persistence =
  // ...
  open Npgsql
  open System
  // ...

  let private mapException (ex : System.Exception) =
    match ex with
    | :? AggregateException as agEx  ->
      match agEx.Flatten().InnerException with 
      | :? PostgresException as pgEx ->
        match pgEx.ConstraintName, pgEx.SqlState with 
        | "IX_Users_Email", "23505" -> EmailAlreadyExists
        | "IX_Users_Username", "23505" -> UsernameAlreadyExists
        | _ -> 
          Error pgEx
      | _ -> Error agEx
    | _ -> Error ex
```

We are doing pattern matching over the exception types here. First, we check whether the exception is of type `AggregateException`. If it is, then we flatten it to get the inner exception and check whether it is `PostgresException`. 

In case of `PostgresException`, we do the equality checks on the `ConstraintName` and the `SqlState` properties with the appropriate values and return the corresponding error types. 

For all the type mismatch on the exceptions, we return it as an `Error` case with the actual exception. 

## Refactoring mapException Using Partial Active Patterns

Though we achieved what we want in the `mapException` function, it is a bit verbose. The crux is the equality check on the two properties, and the rest of the code just type casting from one type to other. 

Can we write it better to reflect what we intended to do over here?

Yes, We Can!

The answer is [Partial Active Patterns](https://docs.microsoft.com/en-us/dotnet/fsharp/language-reference/active-patterns#partial-active-patterns). 

Let's add a partial active pattern, `UniqueViolation`, in the `Database` module which does the pattern matching over the exception types and parameterizes the check on the constraint name.

```fsharp
// src/FsTweet.Web/Db.fs
module Database
// ...
open Npgsql
open System

let (|UniqueViolation|_|) constraintName (ex : Exception) =
  match ex with
  | :? AggregateException as agEx  ->
    match agEx.Flatten().InnerException with 
    | :? PostgresException as pgEx ->
      if pgEx.ConstraintName = constraintName && 
          pgEx.SqlState = "23505" then
        Some ()
      else None
    | _ -> None
  | _ -> None
```

Then with the help of this partial active pattern, we can rewrite the `mapException` as 

```fsharp
let private mapException (ex : System.Exception) =
  match ex with
  | UniqueViolation "IX_Users_Email" _ ->
    EmailAlreadyExists
  | UniqueViolation "IX_Users_Username" _ -> 
    UsernameAlreadyExists
  | _ -> Error ex
```

More readable isn't it?

## Summary

Excellent, We learned a lot of things in this blog post!

We started with initializing SQLProvider, then configured it to work with a different database in runtime, and followed it up by creating a function to return a new Data Context for every database operation. 

Finally, we transformed the return type of SQLProvider to our custom Domain type! 

The source code of this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.8)