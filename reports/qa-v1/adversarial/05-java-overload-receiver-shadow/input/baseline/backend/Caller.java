package qa;
class Caller {
 Service service;
 void use() { service.run(null); } // ambiguous-overload
 void zero() { service.zero(); } // unique-zero
 void param(Object service) { service.zero(); } // object-shadow
 void block() { { var service = dynamic(); service.zero(); } service.zero(); } // var-shadow-and-restoration
 Object dynamic() { return null; }
}