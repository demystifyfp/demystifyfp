---
title: "Generic Programming Made Easy"
date: 2017-12-11T19:39:26+05:30
draft: true
tags: ["fsharp", "reflection", "TypeShape", "generics"]
---

Generic programming is a style of computer programming in which algorithms are written in terms of types to-be-specified-later that are then instantiated when needed for specific types provided as parameters[^1]. Generic programming was part of .NET since .NET Version 2.0 and has an [interesting history](https://blogs.msdn.microsoft.com/dsyme/2011/03/15/netc-generics-history-some-photos-from-feb-1999/) as well!

For most of the use cases which involves generics, implementing them in F# is a cake-walk. However, when the generic programming involves reflection, it become a bumpy ride. Let's have a look at the source code[^2] below to get a feel of what I mean here! 

```fsharp
let rec print (value : obj) =
  match value with
  | null -> "<null>"
  | :? int as i -> string i
  | :? string as s -> s
  | _ ->
    let t = value.GetType()
    let isGenTypeOf (gt : Type) =
        t.IsGenericType && gt = t.GetGenericTypeDefinition()
    if isGenTypeOf typedefof<_ option> then
        let value = t.GetProperty("Value").GetValue(value)
        sprintf "Some %s" (print value)
    elif isGenTypeOf typedefof<_ * _> then
        let v1 = t.GetProperty("Item1").GetValue(value)
        let v2 = t.GetProperty("Item2").GetValue(value)
        sprintf "(%s, %s)" (print v1) (print v2)
    else
        value.ToString()
```

The above snippet returns the string representation of the parameter `value`. In the if-else-if expression, the above snippets unwraps the value from the `Option` type and `Tuple` type and return its underlying values by recursively calling the `print` function.

```bash
> print (Some "John");;
val it : string = "Some John"

> print (1,(Some "data"));;
val it : string = "(1, Some data)"
```

The hard coded strings, lack of type safety are some of the concerns in the above snippet. 

```fsharp
let rec print (value : obj) =
  // ...
    if isGenTypeOf typedefof<_ option> then
      let value = t.GetProperty("Value").GetValue(value)
        // ...
    elif isGenTypeOf typedefof<_ * _> then
      let v1 = t.GetProperty("Item1").GetValue(value)
      let v2 = t.GetProperty("Item2").GetValue(value)
      // ...
  // ...
```

F# is not known for these kind of problems. There should be a better way!

Yes, That's where [TypeShape](https://github.com/eiriktsarpalis/TypeShape) comes into picture. 

> TypeShape is a small, extensible F# library for practical generic programming. It uses a combination of reflection, active patterns, visitor pattern and F# object expressions to minimize the amount of reflection that we need to write - Eirik Tsarpalis

In this blog post, we are going to learn the basics of the TypeShape library by implementing an usecase from scratch. In this process, We are also going to learn how to build a reusable library in F# in an incremental fashion. 

> This blog post is a part of the [F# Advent Calendar 2017](https://sergeytihon.com/2017/10/22/f-advent-calendar-in-english-2017/). 

## The Use Case

Reading a value from an environment variable and converting the readed value to a different target type (from `string` type) to consume it is a boilerplate code. 

```fsharp
open System

// unit -> Result<int, string>
let getPortFromEnvVar () =
  let value =
    Environment.GetEnvironmentVariable "PORT"
  match Int32.TryParse value with
  | true, port -> Ok port
  | _ -> Error "unable to get"
``` 

How about making this logic generic and achieving the same using only one function call?

```fsharp
> parsePrimitive<int> "PORT";;

[<Struct>]
val it : EnvVarParseResult<int> = Ok 5432
```

Sounds good, isn't it?

Often the applications that we develop typically reads multiple environment variables. So, How about putting them together in a record type and read all of them in a single shot?

```fsharp
type Config = {
  ConnectionString : string
  Port : int
  EnableDebug : bool
  Environment : string
}

> parseRecord<Config> ();;

[<Struct>]
val it : Result<Config,EnvVarParseError list> =
  Ok {ConnectionString = "Database=foobar;Password=foobaz";
      Port = 5432;
      EnableDebug = true;
      Environment = "staging";}
```

It's even more awesome!!

Let's dive in and implement these two usecases.

## Use Case #1 - Parsing Primitives

### Setting Up

As we will be implementing the use cases by exploring the TypeShape library, F# scripting would be a good fit to get it done. So, let's start with an empty directory and initialize [paket](https://fsprojects.github.io/Paket) using [Forge](https://github.com/fsharp-editing/Forge).

```bash
> mkdir FsEnvConfig
> cd FsEnvConfig
> forge paket init
```

The next step is adding the TypeLibrary and referencing it in the script file.

The entire TypeShape library is available as a single file in GitHub and using Paket's [GitHub File Reference](TODO), we can get it for our development. To do it, first, we first need to add the reference in the *paket.dependencies* which was auto-generated during the initialization of paket. 

```
github eiriktsarpalis/TypeShape:2.20 src/TypeShape/TypeShape.fs
```

Then download this dependency by running the paket's `install` command. 

```bash
> forge paket install
```

After successful execution of this command, you find the *TypeShape.fs* file in the *./paket-files/eiriktsarpalis/TypeShape/src/TypeShape* directory. 

The last step is creating a F# script file *script.fsx* and refer this *TypeShape.fs* file 

```fsharp
// script.fsx
#load "./paket-files/eiriktsarpalis/TypeShape/src/TypeShape/TypeShape.fs"
open TypeShape
```

With this the stage is now set for the action!

### The Domain Types

The first step is defining the types that we are going to work with

```fsharp
type EnvVarParseError =
| BadValue of (string * string)
| NotFound of string
| NotSupported of string

type EnvVarParseResult<'T> = Result<'T, EnvVarParseError>
```

The `EnvVarParseError` type models the possible errors that we may encounter while parsing environment variables. The cases are

* `BadValue` (name , value) - Environment variable is available but casting to the target type fails  
* `NotFound` name - Environment variable with the given name is not found
* `NotSupported` message - We are not supporting the target datatype


The `EnvVarParseResult<'T>` represents the final output of our parsing. It's either either success or failure with any one of the above use cases. We are making use of F# [Result Type](TODO) to model this representation. 

### Getting Started

Let's get started by defining the scaffolding for our `parsePrimitive` function.

```fsharp
// string -> EnvVarParseResult<'T>
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =
  NotSupported "unknown target type"
```

As we are not supporting any type to begin with, we are just returning the `NotSupported` error. 

The important thing to notice here is the generic type `<'T>` in the declaration. It is the target type to which we are going to convert the value stored in the provided environment name. 


Alright, Let's take the next step towards recognizing the target data type `<'T>`.

> Programs parameterized by shapes of datatypes - *Eirik Tsarpalis*

TypeShape library comes with a set of active patters to match shapes of the data type. Let's assume that we are going to consider only int, string and bool for simiplicity. We can do pattern matching with the shape of these types alone in our existing `parsePrimitive` function and handle these cases as below

 ```fsharp
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =
  match shapeof<'T> with
  | Shape.Int32 -> NotSupported "integer"
  | Shape.String -> NotSupported "string"
  | Shape.Bool -> NotSupported "bool"
  | _ -> NotSupported "unknown target type"
```

The `shapeof<'T>` returns the `TypeShape` of the provide generic type `'T`.

If you execute this function in F# interactive, you will be getting the following outputs

```bash
> parsePrimitive<int> "TEST";;
[<Struct>]
val it : EnvVarParseResult<int> =
  Error (NotSupported "integer")

> parsePrimitive<string> "TEST";;
[<Struct>]
val it : EnvVarParseResult<string> =
  Error (NotSupported "string")

> parsePrimitive<bool> "TEST";;
[<Struct>]
val it : EnvVarParseResult<bool> =
  Error (NotSupported "bool")

> parsePrimitive<double> "TEST";;
[<Struct>]
val it : EnvVarParseResult<double> =
  Error (NotSupported "unknown target type")
```

### Parsing Environment Variable

The extended `parsePrimitive` function now able to recognize the shape of the data type. The next step adding logic to parse the environment variable

The `Environment.GetEnvironmentVariable` from .NET library returns `null` if the environment variable with the given name not exists. Let's write a wrapper function `getEnvVar` to return is as `None` instead of `null`. 

```fsharp
// ...
open System
// ...

// string -> string option
let getEnvVar name =
  let v = Environment.GetEnvironmentVariable name
  if v = null then None else Some v

let parsePrimitive<'T> ... = ...
```

Then write the functions which use this `getEnvVar` function and parse the value (if exists) to its specific type.

```fsharp
// (string -> bool * 'a) -> name ->  EnvVarParseResult<'a>
let tryParseWith tryParseFunc name = 
  match getEnvVar name with
  | None -> NotFound name |> Error
  | Some value ->
    match tryParseFunc value with
    | true, v -> Ok v
    | _ -> BadValue (name, value) |> Error


// string -> EnvVarParseResult<int>
let parseInt = tryParseWith Int32.TryParse

// string -> EnvVarParseResult<bool>
let parseBool = tryParseWith Boolean.TryParse

// string -> EnvVarParseResult<string>
let parseString = tryParseWith (fun s -> (true,s))
```

The `tryParseWith` function takes the `tryParseFunc` function of type  `string -> bool * 'a` as its first parameter and the environment variable name as its second parameter. If the environment variable exists, it does the parsing using the provided `tryParseFunc` function and returns either `Ok` with the parsed value or `Error` with the corresponding `EnvVarParseError` value. 

The `parseInt`, `parseBool` and `parseString` functions makes use of this `tryParseWith` function by providing it's corresponding parsing functions. 

### Implementing parsePrimitive function

Now we have functions to parse the specific types and all we need to do now is to leverage them in the `parsePrimitive` function. 

```fsharp
// string -> EnvVarParseResult<'T>
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =
  match shapeof<'T> with
  | Shape.Int32 -> parseInt envVarName
  | Shape.String -> parseString envVarName
  | Shape.Bool -> parseBool envVarName
  | _ -> NotSupported "unknown target type" |> Error
```

Here comes the compiler errors!

```
error FS0001: Type mismatch. Expecting a
    'EnvVarParseResult<'T>'
but given a
    'EnvVarParseResult<int>'
The type ''T' does not match the type 'int'
``` 

```
All branches of a pattern match expression must have the same type. 
This expression was expected to have type ''T', but here has type 'string'.
```

```
All branches of a pattern match expression must have the same type. 
This expression was expected to have type ''T', but here has type 'bool'.
```

As the compiler rightly says, we are suppose to return `EnvVarParseResult` of the provided generic target type `'T`. But we are returning `EnvVarParseResult` with specific types `int` or `bool` or `string`. 

We know that these return types are right based on the pattern matching that we do on the shape of `'T` but the compiler doesn't know! It just doing its job based on the type signature that we provided

```fsharp
// string -> EnvVarParseResult<'T>
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> = 
  ...
```

What to do now?

Well, We can solve this by introducing an another layer of abstraction[^3]

```fsharp
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =

  // (string -> 'a) -> EnvVarParseResult<'T>
  let wrap(p : string -> 'a) = 
    envVarName
    |> unbox<string -> EnvVarParseResult<'T>> p 

  ... 
```

The `wrap` function introduces a new generic type `'a` and accepts a function that takes a `string` and return this new generic type `'a`. Then in its function body, it uses the [unbox function](https://msdn.microsoft.com/en-us/visualfsharpdocs/conceptual/operators.unbox%5B't%5D-function-%5Bfsharp%5D) from F# standard library to unwrap the passed parameter function and call this with the given `envVarName`. 

We can make of this `wrap` function to get rid of the compiler errors.

Here is how the completed `parsePrimitive` function would look like 


```fsharp
let parsePrimitive<'T> (envVarName : string) : EnvVarParseResult<'T> =

  let wrap(p : string -> 'a) = 
    envVarName
    |> unbox<string -> EnvVarParseResult<'T>> p 
    
  match shapeof<'T> with
  | Shape.Int32 -> wrap parseInt
  | Shape.String -> wrap parseString
  | Shape.Bool -> wrap parseBool
  | _ -> NotSupported "unknown target type" |> Error
```

We have solved the problem here by wrapping up the specific return types (`EnvVarParseResult<int>`, `EnvVarParseResult<string>`, `EnvVarParseResult<bool>`) to new generic type `'a` and then unboxing it using the already defined generic type `'T`. 

Now the compiler is happy!

Let's try this in F# interactive

```bash
> parsePrimitive<int> "PORT";;
[<Struct>]
val it : EnvVarParseResult<int> = Error(NotFound "PORT")
```

As there is no environment variable with the name `PORT`, we are getting the `NotFound` error as expected.

If we set an environment variable with the given name `PORT`, and try it again, we can see the successful parsed result!

```bash
> Environment.SetEnvironmentVariable("PORT", "5432");;
val it : unit = ()

> parsePrimitive<int> "PORT";;
[<Struct>]
val it : EnvVarParseResult<int> = Ok 5432
```

Awesome! We acheived the milestone number one!!


## Use Case #2 - Parsing Record Types


[^1]: From [WikiPedia](https://en.wikipedia.org/wiki/Generic_programming)
[^2]: Copied From Eirik Tsarpalis's [Slide](http://eiriktsarpalis.github.io/typeshape/#/12)
[^3]: Fundamental theorem of software engineering - [WikiPedia](Fundamental theorem of software engineering)