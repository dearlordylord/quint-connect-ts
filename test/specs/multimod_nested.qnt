module record_counter {
  const INIT_VAL: int
  var state: { count: int, label: str }

  action init = {
    state' = { count: INIT_VAL, label: "start" }
  }

  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    state' = { count: state.count + amount, label: "incremented" }
  }

  action step = any {
    Increment,
  }
}

module multimod_nested {
  import record_counter(INIT_VAL = 0) as rc

  action init = rc::init
  action step = rc::step
}
