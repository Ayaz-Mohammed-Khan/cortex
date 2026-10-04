---
tags:
  - python
  - exception-handling
  - errors
difficulty: intermediate
prerequisites:
  - File Handling
created: 2026-09-29
---

> [!info] Where this fits
> This follows [[File Handling]], where real-world data (a missing file, a bad format, a dropped connection) is a common source of failures. Exception handling is how a program catches those failures and responds gracefully instead of crashing. It builds on classes from [[Classes & Objects]], since every error in Python is an object of a class.

An **error** can appear in a program at two moments: **before it runs**, when Python parses the code and compiles it to bytecode, and **while it runs**, during execution. This note covers both, but focuses on the second: **exceptions**, the runtime failures you catch and handle so your program degrades gracefully. You will learn why handling matters, the `try`/`except`/`else`/`finally` blocks, catching specific errors, raising your own, and writing custom exception classes.

---

## Syntax errors versus exceptions

The two moments an error can occur give the two families of error:

| | Syntax error | Exception |
| :--- | :--- | :--- |
| When | **before the program runs** (at parse time) | **while the program runs** (execution) |
| Caused by | code that breaks the language's grammar | a logical/runtime problem, even in correct code |
| Raised by | the parser, before any line executes | the Python runtime |
| Fix | debug and rewrite the code | handle it on the fly |

A **syntax error** means something is written against the language's rules, a missing bracket, a missing colon, a misspelled keyword, wrong indentation. Python reports it before running any line, because it cannot parse the file:

```python
print 'hello world'     # SyntaxError: missing parentheses
```

Python cannot parse the code, so it refuses to run and points at the problem. (Bad indentation is reported as its own `IndentationError`, a special kind of syntax error.)

An **exception** is different: the code is written correctly, but something goes wrong *while it runs*.

```python
a = int(input())
b = int(input())
print(a / b)        # fine, unless the user enters b = 0, then it fails at runtime
```

Nothing is wrong with that code. But if the user enters `0` for `b`, division by zero fails during execution. That is an exception, and this note is about handling exceptions.

> [!note]
> Exceptions arise from things the code cannot foresee: a memory overflow loading a huge file, division by zero, a database server going down mid-query, a missing file. The program is correct; the situation is not. Your job is to respond to it without crashing.

---

## Common error types

Every error has a type, and knowing the common ones makes debugging far faster, the name tells you what went wrong.

| Error | Raised when |
| :--- | :--- |
| `IndexError` | accessing an invalid index, `[1,2,3][100]` |
| `ModuleNotFoundError` | importing a module that does not exist, `import maths` |
| `KeyError` | accessing a missing dictionary key |
| `TypeError` | an operation on the wrong type, `1 + 'a'` |
| `ValueError` | a function gets the right type but a bad value, `int('a')` |
| `NameError` | using a variable that was never defined |
| `AttributeError` | calling a method/attribute an object does not have, `[1,2,3].upper()` |

> [!tip]
> When an error appears, read its **type** first. `KeyError` means a missing dictionary key; `TypeError` means you combined incompatible types. The name narrows the cause before you read a single line of the message.

---

## Why handle exceptions

When an exception is not handled, Python prints a **stack trace**: a technical message naming the error type, a description, the file, and the line where it happened. That message is Python communicating with the *programmer*, it is useful during development. But it must never reach a *user*. There are two reasons to handle exceptions:

- **User experience.** Imagine a user finishes a payment and sees a raw stack trace. It is cryptic and alarming. A clear, calm message ("the file could not be found") keeps their trust.
- **Security.** A stack trace exposes file names, line numbers, and code structure on your server. A smart attacker can piece that together to breach the application. You do not want internal detail on the surface.

---

## The try / except block

The core tool is the **`try`/`except` block**: put the risky code in `try`, and what to do when it fails in `except`.

```python
try:
    with open('sample.txt', 'r') as f:
        print(f.read())
except:
    print('Sorry, file not found')
```

If the `try` code raises an exception, control jumps to `except` instead of crashing, and the calm message is shown.

> [!tip]
> Reach for `try`/`except` whenever your code touches **anything external**: opening a file, a database connection, a network or Bluetooth connection. External things fail in ways your code cannot prevent, so wrap them.

---

## Catching specific exceptions

A single bare `except` treats every failure the same, the "government website" approach where every mistake gets one vague "something went wrong, try again." Better to tell the user *exactly* what failed, with one `except` block per error type:

```python
try:
    with open('sample1.txt', 'r') as f:
        print(f.read())
    print(m)          # m is undefined
    print(5 / 0)      # division by zero
except FileNotFoundError:
    print('File not found')
except NameError:
    print('Variable not defined')
except ZeroDivisionError:
    print("Can't divide by zero")
except Exception as e:
    print(e)          # anything not caught above
```

- Each `except <ErrorType>:` handles one specific error with a tailored message.
- `except Exception as e` is a **generic catch-all** for anything you did not anticipate; `e` holds the error object, which you can print.

> [!warning]
> The generic `except Exception` must come **last**. `except` blocks are tried top to bottom, and `Exception` is the parent of nearly every error, so if it comes first it swallows everything and the specific blocks below it never run.

---

## else and finally

Two more blocks complete the structure. Think of the flow as a diamond: from `try` you go either to an `except` (on failure) or to `else` (on success), and both paths then meet at `finally`.

```text
                    try
                  /      \
          (error)          (no error)
            |                  |
         except              else
             \               /
              \             /
                 finally
```

**`else`** runs only when the `try` block succeeds, with no exception. Put the follow-up work that depends on success here, code you are sure will not fail:

```python
try:
    f = open('sample.txt', 'r')
except FileNotFoundError:
    print('File not found')
else:
    print(f.read())      # only runs if the file opened cleanly
    f.close()
```

If `try` fails, an `except` runs and `else` is skipped; if `try` succeeds, `except` is skipped and `else` runs. They are mutually exclusive.

**`finally`** runs **no matter what**, whether an exception occurred or not. It is where you clean up:

```python
try:
    f = open('sample.txt', 'r')
    print(f.read())
except FileNotFoundError:
    print('File not found')
finally:
    print('done')        # always runs, success or failure
```

> [!tip]
> `finally` is for releasing resources: closing a file, a database connection, or a socket. Even if the code fails partway, `finally` guarantees the cleanup runs, so you never leave an open connection that wastes memory or exposes a security hole.

---

## Raising exceptions

So far exceptions have come *from* Python. You can also throw one yourself with **`raise`**, at any point in your code:

```python
raise NameError('something went wrong')
raise ValueError('amount is invalid')
```

In other languages (Java) this is called `throw`, and the relationship is clearer there: `try` → `catch` → `throw`. You **raise** (throw) an error, and an `except` (catch) block catches it. That pairing is what makes `raise` powerful: inside a method you can validate inputs and raise a specific error, which the caller's `try`/`except` then handles.

```python
class Bank:
    def __init__(self, balance):
        self.balance = balance

    def withdraw(self, amount):
        if amount < 0:
            raise Exception('Amount cannot be negative')
        if self.balance < amount:
            raise Exception('Insufficient funds')
        self.balance = self.balance - amount

obj = Bank(10000)
try:
    obj.withdraw(15000)
except Exception as e:
    print(e)             # Insufficient funds
else:
    print('Remaining balance:', obj.balance)
```

The `withdraw` method raises a tailored error for each bad case (negative amount, not enough balance), and the caller catches them in one place. This is clean, deliberate error handling: the method decides what is invalid, the caller decides how to respond.

---

## Custom exceptions

Every built-in error (`ValueError`, `FileNotFoundError`, and the rest) is a **class**, arranged in a hierarchy under a base `Exception` class. Python lets you add your own error type to this hierarchy so it behaves exactly like the built-in ones.

To create a custom exception, define a class that **inherits from `Exception`**:

```python
class MyException(Exception):
    def __init__(self, message):
        self.message = message

class Bank:
    def __init__(self, balance):
        self.balance = balance

    def withdraw(self, amount):
        if self.balance < amount:
            raise MyException('Insufficient funds')
        self.balance = self.balance - amount

obj = Bank(10000)
try:
    obj.withdraw(15000)
except MyException as e:
    print(e.message)     # Insufficient funds
```

- Inheriting from `Exception` is what makes `raise MyException(...)` and `except MyException` work.
- Raising it creates an object of your class; the `except MyException as e` block catches that object.

A custom exception reads as a domain-specific error (`InsufficientFundsError`) rather than a generic `Exception`, which makes code clearer and lets callers catch exactly the failures they care about.

---

## Summary

1. Errors occur at compile time (syntax errors, which break the language's grammar) or run time (exceptions, runtime failures in otherwise-correct code); this note handles exceptions.
2. Common error types (`IndexError`, `KeyError`, `TypeError`, `ValueError`, `NameError`, `AttributeError`, `ModuleNotFoundError`) are named for their cause, read the type first when debugging.
3. Handle exceptions for user experience (show a calm message, not a stack trace) and security (do not expose file names and code structure).
4. `try` holds risky code; `except` runs if it fails. Wrap anything external: files, databases, network connections.
5. Use one `except <ErrorType>` per specific error with a tailored message, and a generic `except Exception` last as a catch-all.
6. `else` runs only when `try` succeeds; `finally` runs no matter what and is where you release resources.
7. `raise` throws an exception yourself at any point; paired with `except` (throw/catch), it lets a method validate and signal errors the caller handles.
8. A custom exception is a class inheriting from `Exception`; it behaves like a built-in error and names a domain-specific failure clearly.

---

> [!info] Continues to
> The next topic, [[Iterators & Generators]], looks at how Python's `for` loop actually works under the hood and how to produce values lazily, one at a time, which is the memory-efficient counterpart to reading files in chunks.
