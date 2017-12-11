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

[^1]: From [WikiPedia](https://en.wikipedia.org/wiki/Generic_programming)
[^2]: Copied From Eirik Tsarpalis's [Slide](http://eiriktsarpalis.github.io/typeshape/#/12)