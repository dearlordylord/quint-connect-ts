module counter {
  var count: int
  var replayAction: { tag: str, value: { amount: int } }

  action init = {
    all {
      count' = 0,
      replayAction' = { tag: "init", value: { amount: 0 } },
    }
  }

  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    all {
      count' = count + amount,
      replayAction' = { tag: "Increment", value: { amount: amount } },
    }
  }

  action step = any {
    Increment,
  }

  run incrementOnce = init.then(Increment)
  run mustNotRun = false
}
