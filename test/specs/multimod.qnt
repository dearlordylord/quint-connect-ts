module counter_base {
  const INIT_VAL: int
  var count: int

  action init = {
    count' = INIT_VAL
  }

  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    count' = count + amount
  }

  action step = any {
    Increment,
  }
}

module multimod {
  import counter_base(INIT_VAL = 0) as ctr

  action init = ctr::init
  action step = ctr::step
}
