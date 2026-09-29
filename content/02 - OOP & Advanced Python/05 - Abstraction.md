---
tags:
  - python
  - oop
  - abstraction
  - abstract-class
difficulty: intermediate
prerequisites:
  - Polymorphism
created: 2026-09-29
---

> [!info] Where this fits
> This is the last of the four core pillars of object-oriented programming, following [[Classes & Objects]], [[Encapsulation]], [[Inheritance]], and [[Polymorphism]]. It builds on inheritance: a parent class uses abstraction to hide how something is done while forcing its child classes to provide certain methods. The focus is on what abstraction is and, just as importantly, when you would actually use it.

**Abstraction** hides implementation detail while exposing only what a user needs. A laptop is abstracted: it hides its circuits and lets you work through a keyboard and screen. This note covers abstract classes and abstract methods, and abstraction's most practical use: forcing every class that builds on yours to implement required methods.

---

## What abstraction is

**Abstraction** hides how something works and exposes only what matters to use it.

- A laptop hides its circuitry; you use it through the keyboard, mouse, and screen.
- Electromagnetic waves are invisible, yet you use them on every call and web page.
- A well-designed class lets you use its capabilities without exposing how they are built.

The pattern is always the same: **the mechanism is hidden, the interface is what you touch.**

---

## Bank example hierarchy

A concrete setting makes abstraction easier to picture: a bank's software as a hierarchy of classes.

```text
                BankApp
          (database, security)
            /            \
        WebApp          MobileApp
```

- `BankApp` (parent) talks to the database and owns all data queries.
- `WebApp` and `MobileApp` (children) inherit from `BankApp` to reach the database.

The child apps use the database capability **without knowing how the connection is implemented**; that detail is hidden inside the parent. This is abstraction across a hierarchy: the parent exposes a capability and hides its mechanism. It is also the setting for building a working abstract class in the next section.

---

## Abstract classes and abstract methods

Abstraction in Python is built from two related ideas:

- An **abstract method** has no implementation, no code in its body, only a declaration that it must exist.
- A **concrete method** is the ordinary kind, with a real body.

An **abstract class** contains at least one abstract method (it may also contain concrete ones). Being abstract has two consequences:

- **You cannot create an object of an abstract class.** It is an incomplete blueprint.
- **Any child must implement every abstract method**, or that child is itself abstract and also cannot be instantiated.

That second rule is the whole point: an abstract method is a **constraint** the parent places on its children, "if you inherit from me, you must provide this method."

> [!tip]
> This is why abstraction is useful. As the author of a top-level class, you force every class built on yours to implement required behavior. A senior developer designing a bank app can require every child app to implement a `security` method, so no one inherits the database features while skipping security.

---

## Coding an abstract class

Python provides abstract classes through the `abc` module (abstract base classes):

- A class becomes abstract by inheriting from `ABC`.
- A method becomes abstract with the `@abstractmethod` decorator.

```python
from abc import ABC, abstractmethod

class BankApp(ABC):
    def database(self):
        print('connected to database')   # a concrete method

    @abstractmethod
    def security(self):
        pass                              # an abstract method: no body
```

`BankApp` is abstract because of `security`. A child that ignores the requirement cannot be built:

```python
class MobileApp(BankApp):
    def mobile_login(self):
        print('login into mobile')

obj = MobileApp()   # error: can't instantiate abstract class
```

Creating `MobileApp` fails, because it inherits an unimplemented `security` and stays abstract. Implement it, and the child becomes concrete and usable, still inheriting the concrete `database` method:

```python
class MobileApp(BankApp):
    def security(self):
        print('mobile security')       # required method implemented

    def mobile_login(self):
        print('login into mobile')

obj = MobileApp()      # works now
obj.database()         # inherited concrete method: connected to database
```

> [!note]
> Reading `BankApp`, you can see that a `security` method must exist, but not how it is implemented, that is left to each child, so a mobile, web, and desktop app can each implement it differently. The detail is abstracted away; only the requirement is visible. Attempting `BankApp()` directly also fails, confirming an abstract class cannot be instantiated.

Abstraction is one of the less frequently used pillars; it earns its place where a top-level class must guarantee that everything built on it provides certain behavior.

---

## Summary

1. Abstraction hides how something works and exposes only what a user needs, like operating a laptop through its keyboard and screen.
2. In a class hierarchy, a parent exposes a capability and hides its mechanism, as a bank app exposes database access to its child apps without revealing the connection detail.
3. An abstract method has no implementation; a concrete method has a real body.
4. An abstract class has at least one abstract method; it cannot be instantiated, and any child must implement every abstract method or remain abstract.
5. The practical use is constraint: a parent forces its children to implement required methods, such as requiring every child app to implement security.
6. In Python, a class becomes abstract by inheriting from `ABC`, and a method becomes abstract with the `@abstractmethod` decorator; a child is usable only once it implements all inherited abstract methods.

---

> [!info] Continues to
> This completes the four core pillars of object-oriented programming: classes and objects, encapsulation, inheritance, polymorphism, and abstraction. The next stages of the roadmap move into the data science libraries [[NumPy & Pandas]], which are themselves built entirely from the OOP ideas covered here.
