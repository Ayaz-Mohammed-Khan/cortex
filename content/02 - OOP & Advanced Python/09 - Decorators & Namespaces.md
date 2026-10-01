---
tags:
  - python
  - decorators
  - namespaces
  - scope
  - closures
difficulty: advanced
prerequisites:
  - Iterators & Generators
created: 2026-09-29
---

> [!info] Where this fits
> This is the final advanced-Python topic, following [[Iterators & Generators]]. It builds directly on the idea that functions are ordinary objects you can pass around and return, the same first-class behavior that made generators possible. Two halves: first **namespaces and scope** (the rules that decide which variable a name refers to), then **decorators** (a way to wrap a function in extra behavior). The second half depends on the first, so they belong together.

A **namespace** is the bookkeeping that maps names to objects; the **LEGB rule** is the order Python searches those namespaces to resolve a name. Understanding both explains a surprising class of bugs and unlocks **decorators**, functions that take another function, add behavior, and return it. This note works up from namespaces and scope to closures, then uses all three to build real, reusable decorators.

---

## Namespaces and scope

A **namespace** is a dictionary that maps **identifiers (names) to objects**. When you write `a = 5`, Python stores `'a' -> 5` in the current namespace. A **scope** is the region of code in which a given namespace is active. Every function call creates its own scope with its own namespace, which is why a variable inside one function does not leak into another.

Python has **four kinds of namespace**:

| Scope | Where it comes from | Lifetime |
| :--- | :--- | :--- |
| **Local** | inside a function | created on call, destroyed on return |
| **Enclosing** | an outer function wrapping an inner one | lives while the outer call is active |
| **Global** | the main program / module level | the whole program run |
| **Built-in** | names Python provides everywhere | always available |

The **built-in** namespace is where names like `print`, `len`, `type`, `min`, `max`, `sorted`, and `input` live. You can see them all:

```python
import builtins
print(dir(builtins))     # every built-in name available to any program
```

---

## The LEGB rule

When you use a name, Python searches the namespaces in a fixed order and stops at the **first** match:

```text
L  ->  Local       (the current function)
E  ->  Enclosing   (any outer functions wrapping it)
G  ->  Global      (the module / main program)
B  ->  Built-in    (names Python always provides)
```

**L → E → G → B.** The search goes outward, never inward, and never continues once a name is found.

A classic consequence: define your own `max` at the global level and the built-in `max` becomes unreachable from global code.

```python
max = 5                 # a global name 'max'
print(max([1, 2, 3]))   # TypeError: 'int' object is not callable
```

Python finds `max` in the **global** namespace first (it is the integer `5`), so it never reaches the built-in function. You have shadowed the built-in.

### Local vs global, and the `global` keyword

A name assigned inside a function is **local** to that function. Reading a global is fine; reassigning it needs the `global` keyword.

```python
a = 1

def change():
    global a      # without this, 'a = 2' would create a new LOCAL a
    a = 2

change()
print(a)          # 2
```

Function parameters are local too, they live only in that call's namespace.

### Enclosing scope and `nonlocal`

When a function is defined **inside** another function, the outer one's namespace is the inner one's **enclosing** scope. The LEGB search checks it after local and before global.

```python
def outer():
    a = 3                 # enclosing variable
    def inner():
        print(a)          # not local; found in the enclosing scope -> 3
    inner()
```

If `inner` had its own `a`, that local would win; if neither had it, Python would continue to global, then built-in, and finally raise `NameError`. To **reassign** an enclosing variable from the inner function, use `nonlocal` (the enclosing-scope counterpart of `global`):

```python
def outer():
    a = 1
    def inner():
        nonlocal a        # target the enclosing a, not a new local
        a += 1
    inner()
    print(a)              # 2
```

> [!note]
> `if`/`else` blocks and loops do **not** create a new scope. A variable assigned inside an `if` or a `for` lives in whatever scope the surrounding code is in. Only functions introduce a new local scope. (This differs from some languages like JavaScript.)

---

## Closures: the bridge to decorators

Normally, when a function returns, its local namespace is destroyed along with its variables. There is one exception, and it is what makes decorators work.

If an inner function uses a variable from its enclosing function **and the inner function is returned**, that variable stays alive even after the outer function has finished. This is called a **closure**: the inner function "closes over" the enclosing variable.

```python
def outer():
    b = 5
    def inner():
        print(b)      # uses the enclosing b
    return inner       # return the function itself, not its result

fn = outer()           # outer() has now finished and returned
fn()                   # prints 5 — b survived because inner still needs it
```

Even though `outer` has returned and would normally be gone from memory, `b` is kept alive because the returned `inner` still references it. In short: **a child function can access its parent's variables even after the parent has finished.** Hold on to this; it is the mechanism behind every decorator.

---

## Decorators

A **decorator** is a function that **receives another function as input, adds some functionality to it, and returns it.** This is possible only because Python functions are **first-class citizens**: you can store them in variables, put them in lists, pass them as arguments, and return them from other functions.

```python
def func():
    print("hello")

a = func          # store the function object in another name
a()               # 'hello' — a now refers to the same function
```

### A first decorator

The decorator takes a function, defines an inner **`wrapper`** that calls the original while adding behavior around it, and returns the `wrapper`:

```python
def my_decorator(func):
    def wrapper():
        print("*" * 20)
        func()                 # call the original function
        print("*" * 20)
    return wrapper             # return the wrapped function (a closure over func)

def hello():
    print("hello")

a = my_decorator(hello)        # a is now the wrapper, closed over hello
a()
# ********************
# hello
# ********************
```

`my_decorator` runs, returns `wrapper`, and finishes, yet `wrapper` can still call `func` afterwards. That is the closure from the previous section doing the real work. The same decorator works on any no-argument function, each one gets the extra decoration for free.

### The `@` shortcut

Writing `a = my_decorator(hello)` then calling `a()` is indirect. Python gives you a shorthand: place `@decorator_name` directly above the function definition.

```python
@my_decorator
def hello():
    print("hello")

hello()            # same output as before — the decorator is applied automatically
```

`@my_decorator` means exactly `hello = my_decorator(hello)`. Now calling `hello()` always runs the wrapped version. This is the syntax you will see in real code.

### A useful decorator: timing any function

Decorations like printing stars are a toy. A genuinely useful decorator measures how long a function takes to run. The key is accepting `*args` so the `wrapper` works for a function with **any** number of arguments:

```python
import time

def timer(func):
    def wrapper(*args):                # accept any arguments
        start = time.time()
        result = func(*args)           # forward them to the original
        print(func.__name__, "took", time.time() - start, "seconds")
        return result
    return wrapper

@timer
def square(num):
    time.sleep(1)
    return num ** 2

@timer
def power(a, b):
    return a ** b

square(5)          # square took 1.00... seconds
power(2, 3)        # power took 0.00... seconds
```

Without `*args`, the inner `func(...)` call would break the moment you decorated a function that needs arguments. `func.__name__` reads the original function's name so the message is informative.

> [!warning]
> A decorator's `wrapper` must forward whatever it receives. Hard-coding `wrapper()` with no parameters makes the decorator usable only on zero-argument functions, calling it on `square(5)` raises a `TypeError`. Use `*args` (and `**kwargs` for keyword arguments) to stay generic.

### Decorators that take arguments

Sometimes the decorator itself needs information beyond the function. For example, a decorator that checks the **data type** of a function's argument needs to be told which type is allowed. This requires **three** nested functions: the outer takes the configuration, the middle takes the function, and the inner is the wrapper.

```python
def sanity_check(data_type):           # 1. takes the configuration (the type)
    def outer_wrapper(func):           # 2. takes the function being decorated
        def inner_wrapper(*args):      # 3. the actual wrapper
            if type(args[0]) == data_type:
                return func(*args)
            else:
                raise TypeError("Wrong data type")
        return inner_wrapper
    return outer_wrapper

@sanity_check(int)
def square(num):
    print(num ** 2)

@sanity_check(str)
def greet(name):
    print("hello", name)

square(2)          # 4
square("hello")    # TypeError: Wrong data type
greet("nitish")    # hello nitish
```

`@sanity_check(int)` first calls `sanity_check(int)`, which returns `outer_wrapper`; that is then applied to `square` just like an ordinary decorator. The extra layer exists purely to capture the argument (`data_type`) in a closure so the wrapper can use it. You will rarely need to go this deep as a data scientist, but it shows how far first-class functions and closures reach.

---

## Summary

1. A **namespace** maps names to objects (a dictionary); a **scope** is the region where a namespace is active, and every function call gets its own.
2. There are four namespaces: **local** (inside a function), **enclosing** (an outer function), **global** (the module), and **built-in** (names like `print`, `len`, `max`).
3. The **LEGB rule** resolves a name by searching Local → Enclosing → Global → Built-in and stopping at the first match; it goes outward only.
4. Shadowing a built-in name in global scope (e.g. `max = 5`) makes the original unreachable, because the search finds the global one first.
5. Use `global` to reassign a module-level variable from inside a function, and `nonlocal` to reassign an enclosing variable from an inner function; `if`/loops do not create scopes.
6. A **closure** lets an inner function keep using an enclosing variable even after the outer function has returned, provided the inner function is returned.
7. A **decorator** takes a function, adds behavior, and returns it; this works because functions are first-class citizens and because of closures.
8. The pattern is an outer function receiving `func`, an inner `wrapper` that calls `func` with extra behavior, and `return wrapper`; `@decorator` is shorthand for `f = decorator(f)`.
9. Make a `wrapper` generic by accepting `*args` (and `**kwargs`) and forwarding them, so the decorator works on functions with any signature; `func.__name__` recovers the original name.
10. A decorator that needs its own argument uses three nested functions, an outer that captures the configuration, a middle that takes the function, and an inner wrapper, so the config lives in a closure.

---

> [!info] Continues to
> This closes the advanced-Python track. With first-class functions, closures, decorators, iterators, generators, exceptions, and file handling in place, you have the Python foundation the rest of the curriculum builds on, including the data-handling libraries where generators and context managers appear constantly.
