package qa;
class Caller {
 Service service;
 void use(Object value) {
  if (value instanceof Other service) { service.zero(); } // pattern-shadow
 }
}